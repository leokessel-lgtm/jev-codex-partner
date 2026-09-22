import assert from 'node:assert/strict';
import test from 'node:test';
import { normaliseGatewayResponse } from '../src/output-normalisation.mjs';

const QUESTIONS = {
  refunded: {
    type: 'boolean',
    instructions: 'Was the payment refunded?',
  },
  outcome: {
    type: 'choice',
    instructions: 'Choose the supported outcome.',
    criteria: {
      proceed: 'All gates pass.',
      hold: 'At least one gate remains.',
    },
  },
  quality: {
    type: 'score',
    instructions: 'Score the evidence quality.',
    criteria: ['Unsupported', 'Partly supported', 'Fully supported'],
  },
};

const CONTEXT = {
  questions: QUESTIONS,
  durationMs: 42,
  attempts: 2,
  dataClassification: 'synthetic',
};

function validResponse(overrides = {}) {
  const response = {
    model: 'typesafe-ai/jev',
    answers: {
      refunded: { type: 'boolean', probability: 0.98 },
      outcome: {
        type: 'choice',
        value: 'proceed',
        probabilities: { proceed: 0.75, hold: 0.25 },
      },
      quality: {
        type: 'score',
        value: 2,
        probabilities: [0.01, 0.19, 0.8],
      },
    },
    usage: { inputTokens: 275, outputTokens: 20 },
    providerMetadata: {
      gateway: {
        routing: {
          originalModelId: 'typesafe-ai/jev',
          resolvedProvider: 'typesafe-ai',
          canonicalSlug: 'typesafe-ai/jev',
          finalProvider: 'typesafe-ai',
        },
        cost: '0.00001155',
        marketCost: '0.00001155',
        surchargeCost: '0',
        gatewayCost: '0.00001155',
        generationId: 'gen_test',
      },
    },
  };
  return { ...response, ...overrides };
}

function rejects(raw, context = CONTEXT) {
  assert.throws(() => normaliseGatewayResponse(raw, context), /invalid JEV response/i);
}

test('boolean, choice and score answers are strictly normalised with allow-listed fields', () => {
  const raw = validResponse({
    ignoredTopLevel: 'discard me',
  });
  raw.answers.refunded.confidence = 0.91;
  raw.answers.refunded.ignored = 'discard me';
  raw.providerMetadata.gateway.ignored = 'discard me';
  raw.providerMetadata.otherProvider = { secret: 'discard me' };

  assert.deepEqual(normaliseGatewayResponse(raw, CONTEXT), {
    provider: 'typesafe-ai',
    requestedModel: 'typesafe-ai/jev',
    resolvedModel: 'typesafe-ai/jev',
    answers: {
      refunded: { type: 'boolean', probability: 0.98, confidence: 0.91 },
      outcome: {
        type: 'choice',
        value: 'proceed',
        probabilities: { proceed: 0.75, hold: 0.25 },
      },
      quality: {
        type: 'score',
        value: 2,
        probabilities: [0.01, 0.19, 0.8],
      },
    },
    usage: { inputTokens: 275, outputTokens: 20 },
    cost: {
      cost: '0.00001155',
      marketCost: '0.00001155',
      surchargeCost: '0',
      gatewayCost: '0.00001155',
    },
    requestId: 'gen_test',
    durationMs: 42,
    attempts: 2,
    dataClassification: 'synthetic',
    warnings: ['JEV output is advisory; typed output does not establish correctness.'],
  });
});

test('question IDs must be present exactly once with no unknown answers', () => {
  const missing = validResponse();
  delete missing.answers.quality;
  rejects(missing);

  const unknown = validResponse();
  unknown.answers.unrequested = { type: 'boolean', probability: 0.5 };
  rejects(unknown);

  const duplicateIds = new Proxy({}, {
    ownKeys: () => ['refunded', 'refunded'],
    getOwnPropertyDescriptor: () => ({ enumerable: true, configurable: true }),
    get: () => ({ type: 'boolean', probability: 0.5 }),
  });
  rejects(validResponse({ answers: duplicateIds }), {
    ...CONTEXT,
    questions: { refunded: QUESTIONS.refunded },
  });
});

test('boolean, choice and score answer types must match their questions', () => {
  for (const [id, type] of [
    ['refunded', 'choice'],
    ['outcome', 'score'],
    ['quality', 'boolean'],
  ]) {
    const raw = validResponse();
    raw.answers[id].type = type;
    rejects(raw);
  }
});

test('choice value must name one of the declared criteria', () => {
  const raw = validResponse();
  raw.answers.outcome.value = 'unknown';
  rejects(raw);
});

test('score value must be an integer within the declared criteria range', () => {
  for (const value of [-1, 1.5, 3, '2']) {
    const raw = validResponse();
    raw.answers.quality.value = value;
    rejects(raw);
  }
});

test('choice probability keys must exactly match the criteria', () => {
  for (const probabilities of [
    { proceed: 1 },
    { proceed: 0.5, hold: 0.4, unknown: 0.1 },
  ]) {
    const raw = validResponse();
    raw.answers.outcome.probabilities = probabilities;
    rejects(raw);
  }
});

test('choice probability output preserves an own __proto__ criterion key', () => {
  const criteria = JSON.parse('{"__proto__":"Selected outcome.","hold":"Hold outcome."}');
  const probabilities = JSON.parse('{"__proto__":0,"hold":1}');
  const raw = validResponse({
    answers: {
      outcome: { type: 'choice', value: '__proto__', probabilities },
    },
  });
  const context = {
    ...CONTEXT,
    questions: {
      outcome: {
        type: 'choice',
        instructions: 'Choose the supported outcome.',
        criteria,
      },
    },
  };

  const result = normaliseGatewayResponse(raw, context);

  assert.deepEqual(Object.keys(result.answers.outcome.probabilities), ['__proto__', 'hold']);
  assert.equal(Object.hasOwn(result.answers.outcome.probabilities, '__proto__'), true);
  assert.equal(result.answers.outcome.probabilities.__proto__, 0);
});

test('score probability entries must exactly match the criteria count', () => {
  for (const probabilities of [[0.2, 0.8], [0.1, 0.2, 0.3, 0.4]]) {
    const raw = validResponse();
    raw.answers.quality.probabilities = probabilities;
    rejects(raw);
  }
});

test('score probability arrays reject sparse own-index coverage', () => {
  const raw = validResponse();
  raw.answers.quality.probabilities = [0.5, , 0.5];

  rejects(raw);
});

test('probability values and optional confidence must be finite numbers from zero to one', () => {
  const mutations = [
    (raw, value) => { raw.answers.refunded.probability = value; },
    (raw, value) => { raw.answers.outcome.probabilities.proceed = value; },
    (raw, value) => { raw.answers.quality.probabilities[0] = value; },
    (raw, value) => { raw.answers.refunded.confidence = value; },
  ];
  for (const mutate of mutations) {
    for (const value of ['0.5', Number.NaN, Number.POSITIVE_INFINITY, -0.01, 1.01]) {
      const raw = validResponse();
      mutate(raw, value);
      rejects(raw);
    }
  }
});

test('choice and score probability distributions must sum within 0.02 of one', () => {
  for (const [id, probabilities] of [
    ['outcome', { proceed: 0.7, hold: 0.27 }],
    ['outcome', { proceed: 0.8, hold: 0.23 }],
    ['quality', [0.1, 0.2, 0.67]],
    ['quality', [0.1, 0.2, 0.73]],
  ]) {
    const raw = validResponse();
    raw.answers[id].probabilities = probabilities;
    rejects(raw);
  }

  for (const probabilities of [
    { proceed: 0.5, hold: 0.48 },
    { proceed: 0.5, hold: 0.52 },
  ]) {
    const raw = validResponse();
    raw.answers.outcome.probabilities = probabilities;
    assert.doesNotThrow(() => normaliseGatewayResponse(raw, CONTEXT));
  }
});

test('usage token counts must be non-negative finite integers', () => {
  for (const key of ['inputTokens', 'outputTokens']) {
    for (const value of [-1, 1.5, Number.NaN, Number.POSITIVE_INFINITY, '20']) {
      const raw = validResponse();
      raw.usage[key] = value;
      rejects(raw);
    }
  }
});

test('cost fields must be canonical non-negative decimal strings', () => {
  for (const key of ['cost', 'marketCost', 'surchargeCost', 'gatewayCost']) {
    for (const value of [-1, 0, '-0.1', '1e-3', '.5', '1.', 'NaN', '', null]) {
      const raw = validResponse();
      raw.providerMetadata.gateway[key] = value;
      rejects(raw);
    }
  }
});

test('routing metadata must be present and consistently TypeSafe-only', () => {
  const paths = [
    ['originalModelId', 'other/model'],
    ['resolvedProvider', 'other'],
    ['canonicalSlug', 'other/model'],
    ['finalProvider', 'other'],
  ];
  for (const [key, value] of paths) {
    const raw = validResponse();
    raw.providerMetadata.gateway.routing[key] = value;
    rejects(raw);
  }

  for (const mutate of [
    (raw) => { raw.model = 'other/model'; },
    (raw) => { delete raw.providerMetadata; },
    (raw) => { delete raw.providerMetadata.gateway; },
    (raw) => { delete raw.providerMetadata.gateway.routing; },
    (raw) => { delete raw.providerMetadata.gateway.routing.finalProvider; },
  ]) {
    const raw = validResponse();
    mutate(raw);
    rejects(raw);
  }
});

test('generation IDs must be bounded safe identifiers without credential-shaped content', () => {
  for (const generationId of [
    '',
    'a'.repeat(129),
    'contains a space',
    'line\nbreak',
    '../path',
    ['ghp_', 'a'.repeat(24)].join(''),
    ['eyJhbGciOiJIUzI1NiJ9', 'eyJzdWIiOiIxIn0', 'signature'].join('.'),
  ]) {
    const raw = validResponse();
    raw.providerMetadata.gateway.generationId = generationId;
    rejects(raw);
  }

  for (const generationId of ['gen_01HZX-test', '018f47a2-4d99-7f11-a1b2-123456789abc']) {
    const raw = validResponse();
    raw.providerMetadata.gateway.generationId = generationId;
    assert.equal(normaliseGatewayResponse(raw, CONTEXT).requestId, generationId);
  }
});
