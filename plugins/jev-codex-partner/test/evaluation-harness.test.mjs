import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import test from 'node:test';

import { scoreCases, runEvaluation } from '../bin/run-evaluation.mjs';

const execFileAsync = promisify(execFile);
const fixturePath = new URL('../benchmarks/synthetic-cases.json', import.meta.url);

test('scoreCases derives Boolean accuracy from the normalised truth probability', () => {
  const cases = [
    { id: 'bool', classification: 'synthetic', expected: { answer: true }, questions: { answer: { type: 'boolean' } } },
  ];
  const results = [
    { id: 'bool', answers: { answer: { type: 'boolean', probability: 0.8 } } },
  ];

  assert.equal(scoreCases(cases, results).accuracy, 1);
});

test('scoreCases calculates Boolean and Choice Brier score against the expected outcome', () => {
  const cases = [
    { id: 'bool', classification: 'synthetic', expected: { answer: true }, questions: { answer: { type: 'boolean' } } },
    { id: 'choice', classification: 'synthetic', expected: { answer: 'yes' }, questions: { answer: { type: 'choice' } } },
  ];
  const results = [
    { id: 'bool', answers: { answer: { type: 'boolean', probability: 0.8 } } },
    { id: 'choice', answers: { answer: { type: 'choice', value: 'no', probabilities: { yes: 0.25, no: 0.75 } } } },
  ];

  const scored = scoreCases(cases, results);

  const booleanBinaryBrier = 0.2 ** 2;
  const choiceMulticlassBrier = ((0.25 - 1) ** 2) + ((0.75 - 0) ** 2);
  assert.ok(Math.abs(scored.brierScore - ((booleanBinaryBrier + choiceMulticlassBrier) / 2)) < 1e-12);
  assert.equal(scored.brierMethod, 'Boolean binary; Choice sum across classes; mean across answered Boolean and Choice questions.');
});

test('scoreCases aggregates nested evaluation cost while retaining other summary metrics', () => {
  const cases = [
    { id: 'bool', classification: 'synthetic', expected: { answer: true }, questions: { answer: { type: 'boolean' } } },
    { id: 'choice', classification: 'synthetic', expected: { answer: 'yes' }, questions: { answer: { type: 'choice' } } },
    { id: 'score', classification: 'synthetic', expected: { answer: 4 }, questions: { answer: { type: 'score' } } },
    { id: 'missing', classification: 'synthetic', expected: { answer: false }, questions: { answer: { type: 'boolean' } } },
  ];
  const results = [
    { id: 'bool', answers: { answer: { type: 'boolean', probability: 0.8 } }, latencyMs: 12, usage: { inputTokens: 10, outputTokens: 3 }, cost: { cost: '0.01' } },
    { id: 'choice', answers: { answer: { value: 'no', probabilities: { yes: 0.25, no: 0.75 } } }, latencyMs: 18 },
    { id: 'score', answers: { answer: { value: 3 } }, latencyMs: 10 },
    { id: 'missing', answers: {} },
  ];
  const scored = scoreCases(cases, results);
  assert.equal(scored.cost, 0.01);
  assert.equal(scored.accuracy, 1 / 4);
  assert.equal(scored.answeredAccuracy, 1 / 3);
  assert.equal(scored.labelledCases, 4);
  assert.equal(scored.answeredCases, 3);
  assert.equal(scored.scoreMae, 1);
  assert.deepEqual(scored.failures, { total: 1, provider: 0, validation: 0, missingAnswer: 1 });
  assert.equal(scored.reviewRate, 2 / 4);
  assert.deepEqual(scored.latency, { count: 3, meanMs: 40 / 3, p95Ms: 18 });
  assert.deepEqual(scored.usage, { inputTokens: 10, outputTokens: 3 });
});

test('review rate flags low-confidence and missing answers, not high-confidence errors', () => {
  const cases = [
    { id: 'low-correct', classification: 'synthetic', expected: { answer: true }, questions: { answer: { type: 'boolean' } } },
    { id: 'high-wrong', classification: 'synthetic', expected: { answer: 'yes' }, questions: { answer: { type: 'choice' } } },
    { id: 'missing', classification: 'synthetic', expected: { answer: false }, questions: { answer: { type: 'boolean' } } },
  ];
  const results = [
    { id: 'low-correct', answers: { answer: { type: 'boolean', probability: 0.6 } } },
    { id: 'high-wrong', answers: { answer: { type: 'choice', value: 'no', probabilities: { yes: 0.1, no: 0.9 } } } },
    { id: 'missing', answers: {} },
  ];

  const scored = scoreCases(cases, results, { reviewThreshold: 0.75 });

  assert.equal(scored.reviewRate, 2 / 3);
  assert.deepEqual(scored.failures, { total: 1, provider: 0, validation: 0, missingAnswer: 1 });
});

test('configured probability bands report reliability counts and hit rates', () => {
  const cases = [
    { id: 'a', classification: 'synthetic', expected: { answer: true }, questions: { answer: { type: 'boolean' } } },
    { id: 'b', classification: 'synthetic', expected: { answer: true }, questions: { answer: { type: 'boolean' } } },
  ];
  const results = [
    { id: 'a', answers: { answer: { type: 'boolean', probability: 0.8 } } },
    { id: 'b', answers: { answer: { type: 'boolean', probability: 0.4 } } },
  ];
  const scored = scoreCases(cases, results, { probabilityBands: [0.5, 0.75, 1] });
  assert.deepEqual(scored.reliability, [
    { lower: 0.5, upper: 0.75, count: 1, hits: 0, observedHitRate: 0 },
    { lower: 0.75, upper: 1, count: 1, hits: 1, observedHitRate: 1 },
  ]);
});

test('non-synthetic fixtures are rejected', () => {
  assert.throws(() => scoreCases([{ id: 'private', classification: 'private' }], []), /synthetic/);
});

test('probability bands must be finite, strictly increasing values from zero to one', () => {
  const cases = [{ id: 'a', classification: 'synthetic', expected: { answer: true }, questions: { answer: { type: 'boolean' } } }];
  for (const probabilityBands of [
    [0, 0.5, Number.NaN, 1],
    [0, 0.75, 0.5, 1],
    [0, 0.5, 0.5, 1],
    [-0.1, 0.5, 1],
    [0, 0.5, 1.1],
    [0.5],
  ]) {
    assert.throws(() => scoreCases(cases, [], { probabilityBands }), /probability bands/i);
  }
});

test('failure reporting separates provider, validation and missing-answer categories', () => {
  const cases = [
    { id: 'provider', classification: 'synthetic', expected: { answer: true }, questions: { answer: { type: 'boolean' } } },
    { id: 'validation', classification: 'synthetic', expected: { answer: true }, questions: { answer: { type: 'boolean' } } },
    { id: 'missing', classification: 'synthetic', expected: { answer: true }, questions: { answer: { type: 'boolean' } } },
  ];
  const results = [
    { id: 'provider', failureCategory: 'provider' },
    { id: 'validation', failureCategory: 'validation' },
    { id: 'missing', answers: {} },
  ];

  assert.deepEqual(scoreCases(cases, results).failures, {
    total: 3,
    provider: 1,
    validation: 1,
    missingAnswer: 1,
  });
});

test('preview prints fixture count and SHA-256 with zero network activity', async () => {
  const { stdout, stderr } = await execFileAsync(process.execPath, ['bin/run-evaluation.mjs', 'benchmarks/synthetic-cases.json'], {
    env: { ...process.env, AI_GATEWAY_API_KEY: 'must-not-print' },
  });
  assert.equal(stderr, '');
  assert.match(stdout, /cases:\s+\d+/);
  assert.match(stdout, /fixtureSha256:\s+[a-f0-9]{64}/);
  assert.match(stdout, /evaluationCalls:\s+0/);
  assert.match(stdout, /httpAttempts:\s+0/);
  assert.doesNotMatch(stdout, /must-not-print|state|api[_-]?key/i);
});

test('live without confirmation exits before constructing network activity', async () => {
  await assert.rejects(
    execFileAsync(process.execPath, ['bin/run-evaluation.mjs', 'benchmarks/synthetic-cases.json', '--live'], {
      env: { ...process.env, AI_GATEWAY_API_KEY: 'must-not-print' },
    }),
    (error) => error.code === 2 && /confirm-synthetic/.test(error.stderr) && !/must-not-print/.test(error.stderr),
  );
});

test('fixture is valid JSON and runEvaluation defaults to dry mode', async () => {
  const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
  assert.ok(Array.isArray(fixture));
  const summary = await runEvaluation({ fixturePath: fixturePath.pathname });
  assert.deepEqual(summary.networkActivity, { evaluationCalls: 0, httpAttempts: 0 });
});

test('confirmed live mode sends each synthetic fixture exactly once through the validated handler', async () => {
  const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
  const payloads = [];
  const gatewayClient = {
    async evaluate({ providerPayload }) {
      payloads.push(providerPayload);
      const [questionId, question] = Object.entries(providerPayload.questions)[0];
      const answer = question.type === 'boolean'
        ? { type: 'boolean', probability: 0.9 }
        : question.type === 'choice'
          ? { type: 'choice', choice: 'A', probabilities: { A: 0.9, B: 0.1 } }
          : { type: 'score', score: 4, probabilities: { 0: 0.01, 1: 0.01, 2: 0.03, 3: 0.05, 4: 0.9 } };
      return {
        raw: {
          model: 'typesafe-ai/jev',
          answers: { [questionId]: answer },
          usage: { inputTokens: 10, outputTokens: 2 },
          providerMetadata: {
            gateway: {
              generationId: `synthetic-${payloads.length}`,
              cost: '0.01',
              marketCost: '0.01',
              surchargeCost: '0',
              gatewayCost: '0',
              routing: {
                originalModelId: 'typesafe-ai/jev',
                resolvedProvider: 'typesafe-ai',
                canonicalSlug: 'typesafe-ai/jev',
                finalProvider: 'typesafe-ai',
              },
            },
          },
        },
        durationMs: 5,
        attempts: 1,
      };
    },
  };

  const summary = await runEvaluation({
    fixturePath: fixturePath.pathname,
    live: true,
    confirmSynthetic: true,
    gatewayClient,
  });

  assert.equal(payloads.length, fixture.length);
  assert.deepEqual(summary.networkActivity, {
    evaluationCalls: fixture.length,
    httpAttempts: fixture.length,
  });
  assert.deepEqual(summary.metrics.failures, { total: 0, provider: 0, validation: 0, missingAnswer: 0 });
  assert.ok(Math.abs(summary.metrics.cost - 0.03) < 1e-12);
});

test('live CLI prints the complete stable metrics object without payload state or credentials', async () => {
  const preload = `
    globalThis.fetch = async (_url, init) => {
      const request = JSON.parse(init.body);
      const [questionId, question] = Object.entries(request.questions)[0];
      const answer = question.type === 'boolean'
        ? { type: 'boolean', probability: 0.9 }
        : question.type === 'choice'
          ? { type: 'choice', choice: 'A', probabilities: { A: 0.9, B: 0.1 } }
          : { type: 'score', score: 4, probabilities: { 0: 0.01, 1: 0.01, 2: 0.03, 3: 0.05, 4: 0.9 } };
      return new Response(JSON.stringify({
        model: 'typesafe-ai/jev',
        answers: { [questionId]: answer },
        usage: { inputTokens: 10, outputTokens: 2 },
        providerMetadata: { gateway: {
          generationId: 'offline_cli_test',
          cost: '0.01', marketCost: '0.01', surchargeCost: '0', gatewayCost: '0',
          routing: {
            originalModelId: 'typesafe-ai/jev', resolvedProvider: 'typesafe-ai',
            canonicalSlug: 'typesafe-ai/jev', finalProvider: 'typesafe-ai'
          }
        } }
      }), { status: 200, headers: { 'content-type': 'application/json' } });
    };
  `;
  const { stdout, stderr } = await execFileAsync(process.execPath, [
    `--import=data:text/javascript,${encodeURIComponent(preload)}`,
    'bin/run-evaluation.mjs',
    'benchmarks/synthetic-cases.json',
    '--live',
    '--confirm-synthetic',
  ], { env: { ...process.env, AI_GATEWAY_API_KEY: 'offline-cli-key' } });

  assert.equal(stderr, '');
  assert.match(stdout, /evaluationCalls:\s+3/);
  assert.match(stdout, /httpAttempts:\s+3/);
  const metricsLine = stdout.split('\n').find((line) => line.startsWith('metrics: '));
  const metrics = JSON.parse(metricsLine.slice('metrics: '.length));
  assert.deepEqual(Object.keys(metrics).sort(), [
    'accuracy', 'answeredAccuracy', 'answeredCases', 'brierMethod', 'brierScore', 'cost',
    'failures', 'labelledCases', 'latency', 'reliability', 'reviewRate', 'scoreMae', 'usage',
  ]);
  assert.ok(Array.isArray(metrics.reliability));
  assert.deepEqual(metrics.failures, { total: 0, provider: 0, validation: 0, missingAnswer: 0 });
  assert.doesNotMatch(stdout, /offline-cli-key|Fictional Harbourview|state/i);
});

test('synthetic Score fixture describes its zero-indexed 0 to 4 rubric', async () => {
  const fixture = JSON.parse(await readFile(fixturePath, 'utf8'));
  const scoreCase = fixture.find((item) => Object.values(item.questions).some((question) => question.type === 'score'));
  assert.match(Object.values(scoreCase.questions)[0].instructions, /0 to 4/i);
});
