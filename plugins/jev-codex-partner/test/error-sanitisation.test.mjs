import assert from 'node:assert/strict';
import test from 'node:test';
import { sanitiseText } from '../src/error-sanitisation.mjs';

const structuredCredentials = [
  ['Bear', 'er ', 'abcdefghijklmnopqrstuvwxyz012345'].join(''),
  ['eyJhbGciOiJIUzI1NiJ9', 'eyJzdWIiOiIxMjM0NTY3ODkwIn0', 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk'].join('.'),
  ['-----BEGIN PRIVATE KEY-----', 'private-material', '-----END PRIVATE KEY-----'].join('\n'),
];

test('redact removes bearer tokens, JWTs and PEM private keys', () => {
  const result = sanitiseText(structuredCredentials.join(' | '));
  assert.equal(result, '[REDACTED] | [REDACTED] | [REDACTED]');
  assert.doesNotMatch(result, /abcdef|eyJhbGci|private-material/);
});

test('redact preserves ordinary prose containing credential-related words', () => {
  const input = 'The password policy and authorisation guidance require review; no secret value is present.';
  assert.equal(sanitiseText(input), input);
});

test('redact accepts an Error but does not expose or retain its cause', () => {
  const original = new Error(`Provider rejected ${structuredCredentials[0]}`, {
    cause: new Error('internal credential-bearing object'),
  });
  const result = sanitiseText(original);
  assert.equal(result, 'Provider rejected [REDACTED]');
  assert.equal(typeof result, 'string');
  assert.equal(Object.hasOwn(result, 'cause'), false);
});

test('redact caps provider detail at 4,096 UTF-8 bytes without splitting multibyte text', () => {
  const result = sanitiseText('🙂'.repeat(1_025));
  assert.equal(Buffer.byteLength(result, 'utf8'), 4_096);
  assert.equal(result, '🙂'.repeat(1_024));
});

test('redact preserves ordinary dotted prose and domains that are not credible JWTs', () => {
  const input = 'See docs.example.com and release.notes.today for ordinary dotted prose.';
  assert.equal(sanitiseText(input), input);
});

test('redact uses scheme, token structure and context to distinguish bearer credentials from prose', () => {
  const upperScheme = ['Bear', 'er '].join('');
  const lowerScheme = ['bear', 'er '].join('');
  const cases = [
    [`${lowerScheme}${'a'.repeat(32)}`, '[REDACTED]'],
    [`Gateway rejected ${upperScheme}abcdefghij`, 'Gateway rejected [REDACTED]'],
    [`Provider rejected ${upperScheme}x: invalid`, 'Provider rejected [REDACTED]: invalid'],
    [`${upperScheme}x`, '[REDACTED]'],
    [`Authorization: ${upperScheme}x`, 'Authorization: [REDACTED]'],
  ];
  for (const [input, expected] of cases) {
    assert.equal(sanitiseText(input), expected);
  }

  const prose = 'Bearer John presented identification.';
  assert.equal(sanitiseText(prose), prose);
});

test('redact recognises capitalised short bearer tokens terminated by exclamation or question marks', () => {
  const scheme = ['Bear', 'er '].join('');
  assert.equal(sanitiseText(`Rejected ${scheme}x! invalid`), 'Rejected [REDACTED]! invalid');
  assert.equal(sanitiseText(`Rejected ${scheme}x? invalid`), 'Rejected [REDACTED]? invalid');
});

for (const [caseName, input, expected] of [
  [
    'lower-case short bearer token terminated by an exclamation mark',
    `Rejected ${['bear', 'er '].join('')}x! invalid`,
    'Rejected [REDACTED]! invalid',
  ],
  [
    'lower-case short bearer token terminated by a question mark',
    `Rejected ${['bear', 'er '].join('')}x? invalid`,
    'Rejected [REDACTED]? invalid',
  ],
  [
    'embedded lower-case alpha-only bearer token of exactly 20 characters',
    `Rejected ${['bear', 'er '].join('')}${'a'.repeat(20)} because invalid`,
    'Rejected [REDACTED] because invalid',
  ],
  [
    'embedded lower-case alpha-only bearer token of 20 or more characters',
    `Rejected ${['bear', 'er '].join('')}abcdefghijklmnopqrstuvwxyz because invalid`,
    'Rejected [REDACTED] because invalid',
  ],
]) {
  test(`redact recognises ${caseName}`, () => {
    assert.equal(sanitiseText(input), expected);
  });
}

test('redact leaves long lower-case bearer prose unchanged', () => {
  const prose = 'The bearer identification requirement is clear.';
  assert.equal(sanitiseText(prose), prose);
});

test('redact leaves an embedded alpha-only bearer candidate below 20 characters unchanged by length alone', () => {
  const input = `Rejected ${['bear', 'er '].join('')}${'a'.repeat(19)} because invalid`;
  assert.equal(sanitiseText(input), input);
});

test('redact removes all content following an unterminated PEM private-key marker', () => {
  const marker = '-----BEGIN PRIVATE KEY-----';
  const input = `Provider detail: ${marker}\nprivate-material\nmore-sensitive-content`;
  assert.equal(sanitiseText(input), 'Provider detail: [REDACTED]');
});

test('redact removes high-signal vendor tokens and textual credential assignments', () => {
  const vendorToken = ['ghp_', 'b'.repeat(24)].join('');
  const assignmentValue = 'c'.repeat(24);
  const input = `Provider rejected ${vendorToken}; client_secret=${assignmentValue}`;
  const result = sanitiseText(input);

  assert.equal(result, 'Provider rejected [REDACTED]; client_secret=[REDACTED]');
  assert.doesNotMatch(result, new RegExp(`${vendorToken}|${assignmentValue}`, 'u'));
});

test('redact removes provider-prefixed textual credential assignments', () => {
  const value = 'd'.repeat(24);
  const result = sanitiseText(`AI_GATEWAY_API_KEY=${value}; VERCEL_TOKEN: ${value}`);

  assert.equal(result, 'AI_GATEWAY_API_KEY=[REDACTED]; VERCEL_TOKEN: [REDACTED]');
  assert.doesNotMatch(result, new RegExp(value, 'u'));
});

test('redact preserves ordinary prose about token fields and credential policy', () => {
  const input = 'A session token field and client secret rotation policy are documented without values.';
  assert.equal(sanitiseText(input), input);
});
