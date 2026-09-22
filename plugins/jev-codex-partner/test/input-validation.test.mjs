import assert from 'node:assert/strict';
import test from 'node:test';
import { MODEL_ID, PROVIDER_OPTIONS } from '../src/contracts.mjs';
import { findCredentialPath, validateEvaluateInput } from '../src/input-validation.mjs';

function validInput(overrides = {}) {
  const input = {
    purpose: 'Decide whether the release evidence is sufficient.',
    state: 'The checks passed.',
    questions: {
      ready: {
        type: 'boolean',
        instructions: 'Determine whether the evidence supports release.',
        criteria: { true: 'Evidence is sufficient.', false: 'Evidence is insufficient.' },
      },
    },
    data_classification: 'synthetic',
    sensitive_transfer_approved: false,
    use_case_id: 'release-readiness',
    request_metadata: { correlation_id: 'request-123' },
  };

  if ('classification' in overrides) input.data_classification = overrides.classification;
  if ('approved' in overrides) input.sensitive_transfer_approved = overrides.approved;
  return { ...input, ...overrides };
}

function cleanOverrides(input) {
  delete input.classification;
  delete input.approved;
  return input;
}

function jsonBytes(value) {
  return Buffer.byteLength(JSON.stringify(value), 'utf8');
}

function providerPayloadFor(input) {
  return {
    model: MODEL_ID,
    state: input.state,
    questions: input.questions,
    providerOptions: PROVIDER_OPTIONS,
  };
}

function textForBytes(byteLength, multibyte) {
  if (!multibyte) return 'a'.repeat(byteLength);
  const emojiCount = Math.floor(byteLength / 4);
  return '🙂'.repeat(emojiCount) + 'a'.repeat(byteLength - emojiCount * 4);
}

function inputWithProviderPayloadBytes(target, multibyte = false) {
  const input = {
    purpose: 'p',
    state: 's',
    questions: {
      q1: { type: 'boolean', instructions: 'a'.repeat(20_000) },
      q2: { type: 'boolean', instructions: 'b'.repeat(20_000) },
      q3: { type: 'boolean', instructions: '' },
    },
    data_classification: 'synthetic',
    sensitive_transfer_approved: false,
  };
  const paddingBytes = target - jsonBytes(providerPayloadFor(input));
  assert.ok(paddingBytes >= 0, `target ${target} is smaller than the fixture`);
  input.questions.q3.instructions = textForBytes(paddingBytes, multibyte);
  assert.equal(jsonBytes(providerPayloadFor(input)), target);
  return input;
}

function inputWithStateQuestionBytes(target, multibyte = false) {
  const input = cleanOverrides(validInput({
    state: 's',
    questions: { q: { type: 'boolean', instructions: '' } },
  }));
  const fixedBytes = jsonBytes(input.state) + jsonBytes(input.questions.q);
  const paddingBytes = target - fixedBytes;
  assert.ok(paddingBytes >= 0, `target ${target} is smaller than the fixture`);
  input.questions.q.instructions = textForBytes(paddingBytes, multibyte);
  assert.equal(jsonBytes(input.state) + jsonBytes(input.questions.q), target);
  return input;
}

function inputWithCompleteRequestBytes(target, field, multibyte = false) {
  const input = cleanOverrides(validInput());
  if (field === 'purpose') input.purpose = '';
  else input.request_metadata = { note: '' };
  const paddingBytes = target - jsonBytes(input);
  assert.ok(paddingBytes >= 1, `target ${target} is smaller than the fixture`);
  if (field === 'purpose') input.purpose = textForBytes(paddingBytes, multibyte);
  else input.request_metadata.note = textForBytes(paddingBytes, multibyte);
  assert.equal(jsonBytes(input), target);
  return input;
}

function withFetchSpy(run) {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    throw new Error('fetch must not be called by input validation');
  };
  try {
    return { result: run(), calls: () => calls };
  } finally {
    globalThis.fetch = originalFetch;
  }
}

test('schema accepts a complete Boolean, Choice and Score request without coercion', () => {
  const raw = cleanOverrides(validInput({
    questions: {
      boolean: { type: 'boolean', instructions: 'Return true only for complete evidence.' },
      choice: {
        type: 'choice',
        instructions: 'Choose the best-supported option.',
        criteria: { proceed: 'All gates pass.', hold: 'At least one gate remains.' },
      },
      score: {
        type: 'score',
        instructions: 'Score the evidence quality.',
        criteria: ['Unsupported', 'Partly supported', 'Fully supported'],
      },
    },
  }));
  const result = validateEvaluateInput(raw);
  assert.equal(result.ok, true);
  assert.equal(result.value, raw);
});

test('schema rejects extra properties and string booleans without coercion or defaults', () => {
  for (const raw of [
    cleanOverrides(validInput({ unexpected: true })),
    cleanOverrides(validInput({ approved: 'false' })),
  ]) {
    const snapshot = structuredClone(raw);
    const result = validateEvaluateInput(raw);
    assert.equal(result.ok, false);
    assert.deepEqual(raw, snapshot);
    assert.ok(result.errors.length > 0);
  }
});

test('classification allows synthetic and public inputs without sensitive-transfer approval', () => {
  for (const classification of ['synthetic', 'public']) {
    const result = validateEvaluateInput(cleanOverrides(validInput({ classification })));
    assert.equal(result.ok, true);
    assert.deepEqual(result.providerPayload.providerOptions, {
      gateway: { disallowPromptTraining: true, only: ['typesafe-ai'] },
    });
  }
});

test('approval must be literal true for private and sensitive classifications', () => {
  for (const classification of ['private', 'sensitive']) {
    assert.equal(validateEvaluateInput(cleanOverrides(validInput({ classification, approved: false }))).ok, false);
    assert.equal(validateEvaluateInput(cleanOverrides(validInput({ classification, approved: 'true' }))).ok, false);
    assert.equal(validateEvaluateInput(cleanOverrides(validInput({ classification, approved: true }))).ok, true);
  }
});

test('provider payload contains only governed provider fields', () => {
  const raw = cleanOverrides(validInput({ classification: 'private', approved: true }));
  const result = validateEvaluateInput(raw);
  assert.equal(result.ok, true);
  assert.deepEqual(result.providerPayload, {
    model: 'typesafe-ai/jev',
    state: raw.state,
    questions: raw.questions,
    providerOptions: { gateway: { zeroDataRetention: true, only: ['typesafe-ai'] } },
  });
  for (const excluded of [
    'purpose',
    'data_classification',
    'sensitive_transfer_approved',
    'use_case_id',
    'request_metadata',
  ]) {
    assert.equal(Object.hasOwn(result.providerPayload, excluded), false);
  }
});

test('private and sensitive provider payloads continue to require zero data retention', () => {
  for (const classification of ['private', 'sensitive']) {
    const result = validateEvaluateInput(cleanOverrides(validInput({
      classification,
      approved: true,
    })));
    assert.equal(result.ok, true);
    assert.deepEqual(result.providerPayload.providerOptions, {
      gateway: { zeroDataRetention: true, only: ['typesafe-ai'] },
    });
  }
});

for (const { target, accepted, multibyte } of [
  { target: 63_999, accepted: true, multibyte: false },
  { target: 64_000, accepted: true, multibyte: true },
  { target: 64_001, accepted: false, multibyte: true },
]) {
  test(`provider-payload byte boundary ${accepted ? 'accepts' : 'rejects'} ${target} UTF-8 bytes`, () => {
    const observed = withFetchSpy(() => validateEvaluateInput(inputWithProviderPayloadBytes(target, multibyte)));
    assert.equal(observed.result.ok, accepted);
    assert.equal(observed.calls(), 0);
  });
}

for (const field of ['purpose', 'request_metadata']) {
  for (const { target, accepted, multibyte } of [
    { target: 63_999, accepted: true, multibyte: false },
    { target: 64_000, accepted: true, multibyte: true },
    { target: 64_001, accepted: false, multibyte: true },
  ]) {
    test(`complete-request byte boundary ${accepted ? 'accepts' : 'rejects'} ${target} UTF-8 bytes padded through ${field}`, () => {
      const observed = withFetchSpy(() => validateEvaluateInput(
        inputWithCompleteRequestBytes(target, field, multibyte),
      ));
      assert.equal(observed.result.ok, accepted);
      assert.equal(observed.calls(), 0);
      if (!accepted) assert.match(observed.result.errors[0].message, /complete request/i);
    });
  }
}

for (const { target, accepted, multibyte } of [
  { target: 31_999, accepted: true, multibyte: false },
  { target: 32_000, accepted: true, multibyte: true },
  { target: 32_001, accepted: false, multibyte: true },
]) {
  test(`state-plus-longest-question byte boundary ${accepted ? 'accepts' : 'rejects'} ${target} UTF-8 bytes`, () => {
    const observed = withFetchSpy(() => validateEvaluateInput(inputWithStateQuestionBytes(target, multibyte)));
    assert.equal(observed.result.ok, accepted);
    assert.equal(observed.calls(), 0);
  });
}

test('non-serialisable direct-call input returns a validation error without fetching', () => {
  const cyclicState = { summary: 'safe' };
  cyclicState.self = cyclicState;
  for (const state of [cyclicState, { count: 1n }]) {
    const observed = withFetchSpy(() => validateEvaluateInput(cleanOverrides(validInput({ state }))));
    assert.equal(observed.result.ok, false);
    assert.ok(observed.result.errors.length > 0);
    assert.equal(observed.calls(), 0);
  }
});

test('custom toJSON serializers cannot introduce credentials into the provider payload', () => {
  const structuredCredential = ['Bear', 'er ', 'short'].join('');
  const state = {
    summary: 'safe before serialisation',
    toJSON() {
      return { summary: structuredCredential };
    },
  };

  const observed = withFetchSpy(() => validateEvaluateInput(cleanOverrides(validInput({ state }))));

  assert.equal(observed.result.ok, false);
  assert.ok(observed.result.errors.length > 0);
  assert.equal(observed.calls(), 0);
});

for (const key of [
  'api_key', 'apiKey', 'x-api-key', 'authorization', 'password', 'secret', 'client_secret',
  'private_key', 'access_token', 'refresh_token', 'auth_token', 'id_token', 'session_token',
  'oauth_token', 'bearer_token', 'service_token', 'token', 'credential',
]) {
  test(`credential key ${key} is found recursively and rejected before fetch`, () => {
    const state = { outer: [{ inner: { [key]: 'credential-material' } }] };
    assert.equal(findCredentialPath(state), `$.outer[0].inner.${key}`);
    const observed = withFetchSpy(() => validateEvaluateInput(cleanOverrides(validInput({ state }))));
    assert.equal(observed.result.ok, false);
    assert.equal(observed.calls(), 0);
  });
}

test('credential key matching normalises case, underscores and hyphens', () => {
  assert.equal(findCredentialPath({ nested: { 'ACCESS-TOKEN': 'credential-material' } }), '$.nested.ACCESS-TOKEN');
  assert.equal(findCredentialPath({ nested: { PrivateKey: 'credential-material' } }), '$.nested.PrivateKey');
});

test('provider-prefixed credential keys are found recursively and rejected before fetch', () => {
  for (const key of ['AI_GATEWAY_API_KEY', 'OPENAI_API_KEY', 'VERCEL_TOKEN']) {
    const state = { nested: { [key]: 'credential-material' } };
    assert.equal(findCredentialPath(state), `$.nested.${key}`);
    const observed = withFetchSpy(() => validateEvaluateInput(cleanOverrides(validInput({ state }))));
    assert.equal(observed.result.ok, false);
    assert.equal(observed.calls(), 0);
  }
});

const structuredCredentials = [
  ['Bear', 'er ', 'abcdefghijklmnopqrstuvwxyz012345'].join(''),
  ['eyJhbGciOiJIUzI1NiJ9', 'eyJzdWIiOiIxMjM0NTY3ODkwIn0', 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'].join('.'),
  ['-----BEGIN PRIVATE KEY-----', 'private-material', '-----END PRIVATE KEY-----'].join('\n'),
];

test('credential values are rejected in state, purpose and request metadata', () => {
  for (const credential of structuredCredentials) {
    const cases = [
      cleanOverrides(validInput({ state: { nested: [credential] } })),
      cleanOverrides(validInput({ purpose: `Evaluate this value: ${credential}` })),
      cleanOverrides(validInput({ request_metadata: { nested: { trace: credential } } })),
    ];
    for (const raw of cases) {
      const observed = withFetchSpy(() => validateEvaluateInput(raw));
      assert.equal(observed.result.ok, false);
      assert.equal(observed.calls(), 0);
    }
  }
});

test('credential values are rejected in instructions, Choice criteria and Score criteria', () => {
  const [bearer, jwt, pem] = structuredCredentials;
  const raw = cleanOverrides(validInput({
    questions: {
      boolean: { type: 'boolean', instructions: bearer },
      choice: { type: 'choice', instructions: 'Choose.', criteria: { jwt, other: 'safe' } },
      score: { type: 'score', instructions: 'Score.', criteria: ['safe', pem] },
    },
  }));
  const observed = withFetchSpy(() => validateEvaluateInput(raw));
  assert.equal(observed.result.ok, false);
  assert.equal(observed.calls(), 0);
});

test('high-signal vendor tokens and textual credential assignments are rejected without broad prose matching', () => {
  const credentialValues = [
    ['sk-', 'a'.repeat(24)].join(''),
    ['sk_live_', 'z'.repeat(24)].join(''),
    ['ghp_', 'b'.repeat(24)].join(''),
    ['xoxb-', '1234567890-abcd'].join(''),
    ['client_secret', '=', 'c'.repeat(24)].join(''),
    ['session-token', ': ', 'd'.repeat(24)].join(''),
    ['oauth_token', '=', 'e'.repeat(24)].join(''),
  ];
  for (const state of credentialValues) {
    const observed = withFetchSpy(() => validateEvaluateInput(cleanOverrides(validInput({ state }))));
    assert.equal(observed.result.ok, false);
    assert.equal(observed.calls(), 0);
  }

  for (const state of [
    'The client secret rotation policy is documented without a value.',
    'A session token field may be required by the protocol.',
    'The sk- prefix is mentioned without credential material.',
  ]) {
    assert.equal(validateEvaluateInput(cleanOverrides(validInput({ state }))).ok, true);
  }
});

test('ordinary prose about passwords and authorisation is not treated as credential material', () => {
  const raw = cleanOverrides(validInput({
    purpose: 'Assess whether password guidance and authorisation policy are clear.',
    state: 'No password, secret or authorisation value is included.',
  }));
  assert.equal(findCredentialPath(raw), null);
  assert.equal(validateEvaluateInput(raw).ok, true);
});

test('ordinary dotted prose and domains are not treated as JWT credentials', () => {
  const raw = cleanOverrides(validInput({
    purpose: 'Review docs.example.com and release.notes.today before deciding.',
  }));
  assert.equal(findCredentialPath(raw), null);
  assert.equal(validateEvaluateInput(raw).ok, true);
});

test('bearer credential validation uses scheme, token structure and context without rejecting prose', () => {
  const upperScheme = ['Bear', 'er '].join('');
  const lowerScheme = ['bear', 'er '].join('');
  const credentials = [
    `${lowerScheme}${'a'.repeat(32)}`,
    `Gateway rejected ${upperScheme}abcdefghij`,
    `Provider rejected ${upperScheme}x: invalid`,
    `${upperScheme}x`,
    `Authorization: ${upperScheme}x`,
  ];
  for (const state of credentials) {
    const observed = withFetchSpy(() => validateEvaluateInput(cleanOverrides(validInput({ state }))));
    assert.equal(observed.result.ok, false);
    assert.equal(observed.calls(), 0);
  }

  const prose = cleanOverrides(validInput({ state: 'Bearer John presented identification.' }));
  assert.equal(validateEvaluateInput(prose).ok, true);
});

test('validation rejects capitalised short bearer tokens terminated by exclamation or question marks', () => {
  const scheme = ['Bear', 'er '].join('');
  for (const state of [`Rejected ${scheme}x! invalid`, `Rejected ${scheme}x? invalid`]) {
    const observed = withFetchSpy(() => validateEvaluateInput(cleanOverrides(validInput({ state }))));
    assert.equal(observed.result.ok, false);
    assert.equal(observed.calls(), 0);
  }
});

for (const [caseName, state] of [
  ['lower-case short bearer token terminated by an exclamation mark', `Rejected ${['bear', 'er '].join('')}x! invalid`],
  ['lower-case short bearer token terminated by a question mark', `Rejected ${['bear', 'er '].join('')}x? invalid`],
  ['embedded lower-case alpha-only bearer token of exactly 20 characters', `Rejected ${['bear', 'er '].join('')}${'a'.repeat(20)} because invalid`],
  ['embedded lower-case alpha-only bearer token of 20 or more characters', `Rejected ${['bear', 'er '].join('')}abcdefghijklmnopqrstuvwxyz because invalid`],
]) {
  test(`validation rejects ${caseName}`, () => {
    const observed = withFetchSpy(() => validateEvaluateInput(cleanOverrides(validInput({ state }))));
    assert.equal(observed.result.ok, false);
    assert.equal(observed.calls(), 0);
  });
}

test('validation accepts long lower-case bearer prose', () => {
  const raw = cleanOverrides(validInput({
    state: 'The bearer identification requirement is clear.',
  }));
  assert.equal(findCredentialPath(raw), null);
  assert.equal(validateEvaluateInput(raw).ok, true);
});

test('validation does not reject an embedded alpha-only bearer candidate below 20 characters by length alone', () => {
  const state = `Rejected ${['bear', 'er '].join('')}${'a'.repeat(19)} because invalid`;
  const raw = cleanOverrides(validInput({ state }));
  assert.equal(findCredentialPath(raw), null);
  assert.equal(validateEvaluateInput(raw).ok, true);
});
