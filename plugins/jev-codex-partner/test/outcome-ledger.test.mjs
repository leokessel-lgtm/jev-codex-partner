import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import {
  access,
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  stat,
  symlink,
  truncate,
  writeFile,
} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';

import { createOutcomeLedger } from '../src/outcome-ledger.mjs';

const NOW = new Date('2026-09-30T12:34:56.000Z');
const EVALUATION_ID = '123e4567-e89b-42d3-a456-426614174000';
const OUTCOME_ID = '123e4567-e89b-42d3-a456-426614174001';
const execFileAsync = promisify(execFile);

function input() {
  return {
    purpose: 'PURPOSE_SENTINEL',
    state: { secret: 'STATE_SENTINEL' },
    questions: {
      QUESTION_SENTINEL: {
        type: 'choice',
        instructions: 'INSTRUCTION_SENTINEL',
        criteria: { LABEL_SENTINEL: 'DESCRIPTION_SENTINEL', other: 'OTHER_SENTINEL' },
      },
      score: {
        type: 'score',
        instructions: 'SCORE_INSTRUCTION_SENTINEL',
        criteria: ['RUBRIC_SENTINEL', 'SECOND_RUBRIC_SENTINEL'],
      },
      boolean: {
        type: 'boolean',
        instructions: 'BOOLEAN_INSTRUCTION_SENTINEL',
        criteria: { true: 'TRUE_SENTINEL', false: 'FALSE_SENTINEL' },
      },
    },
    data_classification: 'synthetic',
    sensitive_transfer_approved: false,
    use_case_id: 'USE_CASE_SENTINEL',
    request_metadata: { note: 'METADATA_SENTINEL' },
    ledger: { record: true, correlation_id: 'opaque-123' },
  };
}

function evaluation(overrides = {}) {
  return {
    provider: 'typesafe-ai',
    requestedModel: 'typesafe-ai/jev',
    resolvedModel: 'typesafe-ai/jev',
    pluginVersion: '0.1.9',
    answers: {
      QUESTION_SENTINEL: {
        type: 'choice',
        value: 'LABEL_SENTINEL',
        probabilities: { LABEL_SENTINEL: 0.8, other: 0.2 },
        confidence: 0.7,
      },
      score: { type: 'score', value: 1, probabilities: [0.1, 0.9], confidence: 0.9 },
      boolean: { type: 'boolean', probability: 0.75 },
    },
    usage: { inputTokens: 12, outputTokens: 3 },
    cost: { cost: '0.01', marketCost: '0.01', surchargeCost: '0', gatewayCost: '0.01' },
    requestId: 'provider-request',
    gatewayRequestId: 'gateway-request',
    durationMs: 17,
    attempts: 1,
    dataClassification: 'synthetic',
    warnings: ['advisory'],
    ...overrides,
  };
}

async function fixture(options = {}) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'jev-ledger-'));
  const ids = [EVALUATION_ID, OUTCOME_ID];
  const ledger = createOutcomeLedger({
    directory,
    now: () => NOW,
    randomUUID: () => ids.shift() ?? OUTCOME_ID,
    ...options,
  });
  return { directory, ledger };
}

async function records(directory) {
  const text = await readFile(path.join(directory, 'outcomes-2026-09-30.jsonl'), 'utf8');
  return text.trim().split('\n').map((line) => JSON.parse(line));
}

test('evaluation event contains only approved fields and aggregate numeric metadata', async () => {
  const { directory, ledger } = await fixture();
  const status = await ledger.recordEvaluation({ input: input(), evaluation: evaluation() });
  assert.deepEqual(status, { status: 'recorded', recordId: EVALUATION_ID });
  const [record] = await records(directory);
  assert.deepEqual(Object.keys(record).sort(), [
    'answerSummary', 'attempts', 'correlationId', 'cost', 'dataClassification',
    'durationMs', 'pluginVersion', 'provider', 'questionCount', 'questionTypes',
    'recordId', 'recordType', 'recordedAt', 'requestedModel', 'resolvedModel',
    'schemaVersion', 'usage',
  ].sort());
  assert.deepEqual(record.questionTypes, ['boolean', 'choice', 'score']);
  assert.deepEqual(record.answerSummary, {
    probability: { count: 3, min: 0.75, max: 0.9, mean: 0.8166666666666668 },
    confidence: { count: 2, min: 0.7, max: 0.9, mean: 0.8 },
    choiceOptionCounts: [2],
    scoreRubricSizes: [2],
  });
});

test('event does not contain unique request, question, label or metadata strings', async () => {
  const { directory, ledger } = await fixture();
  await ledger.recordEvaluation({ input: input(), evaluation: evaluation() });
  const text = await readFile(path.join(directory, 'outcomes-2026-09-30.jsonl'), 'utf8');
  for (const sentinel of [
    'PURPOSE_SENTINEL', 'STATE_SENTINEL', 'QUESTION_SENTINEL', 'INSTRUCTION_SENTINEL',
    'LABEL_SENTINEL', 'DESCRIPTION_SENTINEL', 'RUBRIC_SENTINEL', 'USE_CASE_SENTINEL',
    'METADATA_SENTINEL', 'provider-request', 'gateway-request',
  ]) assert.equal(text.includes(sentinel), false, sentinel);
});

test('outcome event contains only enumerated decision fields', async () => {
  const { directory, ledger } = await fixture();
  const result = await ledger.recordOutcome({
    record_id: EVALUATION_ID,
    action: 'overridden',
    override: true,
    outcome: 'incorrect',
  });
  assert.deepEqual(result, { status: 'recorded', eventId: EVALUATION_ID });
  const [record] = await records(directory);
  assert.deepEqual(record, {
    schemaVersion: 1,
    recordType: 'outcome',
    eventId: EVALUATION_ID,
    recordedAt: NOW.toISOString(),
    recordId: EVALUATION_ID,
    action: 'overridden',
    override: true,
    outcome: 'incorrect',
  });
});

test('UTF-8 event boundary accepts 4096 bytes and rejects 4097 bytes', async () => {
  const base = await fixture();
  await base.ledger.recordEvaluation({ input: input(), evaluation: evaluation({ provider: '' }) });
  const baseText = await readFile(path.join(base.directory, 'outcomes-2026-09-30.jsonl'), 'utf8');
  const padding = 4096 - Buffer.byteLength(baseText, 'utf8');
  assert.ok(padding > 0);

  const accepted = await fixture();
  assert.equal((await accepted.ledger.recordEvaluation({
    input: input(), evaluation: evaluation({ provider: 'x'.repeat(padding) }),
  })).status, 'recorded');
  const acceptedText = await readFile(path.join(accepted.directory, 'outcomes-2026-09-30.jsonl'), 'utf8');
  assert.equal(Buffer.byteLength(acceptedText, 'utf8'), 4096);

  const rejected = await fixture();
  assert.deepEqual(await rejected.ledger.recordEvaluation({
    input: input(), evaluation: evaluation({ provider: `🙂${'x'.repeat(padding - 3)}` }),
  }), { status: 'not_recorded', reason: 'disabled_or_unavailable' });
});

test('creates root 0700 and daily file 0600', async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'jev-ledger-parent-'));
  const directory = path.join(parent, 'ledger');
  const ledger = createOutcomeLedger({ directory, now: () => NOW, randomUUID: () => EVALUATION_ID });
  assert.equal((await ledger.recordEvaluation({ input: input(), evaluation: evaluation() })).status, 'recorded');
  assert.equal((await stat(directory)).mode & 0o777, 0o700);
  assert.equal((await stat(path.join(directory, 'outcomes-2026-09-30.jsonl'))).mode & 0o777, 0o600);
});

test('rejects symlinked root and symlinked target file', async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), 'jev-ledger-link-'));
  const real = path.join(parent, 'real');
  const linked = path.join(parent, 'linked');
  await mkdir(real, { mode: 0o700 });
  await symlink(real, linked);
  const linkedLedger = createOutcomeLedger({ directory: linked, now: () => NOW, randomUUID: () => EVALUATION_ID });
  assert.deepEqual(await linkedLedger.recordEvaluation({ input: input(), evaluation: evaluation() }), {
    status: 'not_recorded', reason: 'disabled_or_unavailable',
  });

  const target = path.join(parent, 'target');
  await writeFile(target, 'untouched');
  await symlink(target, path.join(real, 'outcomes-2026-09-30.jsonl'));
  const targetLedger = createOutcomeLedger({ directory: real, now: () => NOW, randomUUID: () => EVALUATION_ID });
  assert.equal((await targetLedger.recordEvaluation({ input: input(), evaluation: evaluation() })).status, 'not_recorded');
  assert.equal(await readFile(target, 'utf8'), 'untouched');
});

test('verifies a newly opened descriptor before changing its mode', async () => {
  let chmodCalls = 0;
  const unavailable = Object.assign(new Error('missing'), { code: 'ENOENT' });
  const fakeFs = {
    async lstat(filename) {
      if (filename === '/ledger') return fakeStats({ kind: 'directory', mode: 0o700 });
      throw unavailable;
    },
    async readdir() { return []; },
    async open() {
      return {
        async chmod() { chmodCalls += 1; },
        async stat() { return fakeStats({ kind: 'file', mode: 0o600, uid: process.getuid() + 1 }); },
        async close() {},
      };
    },
  };
  const ledger = createOutcomeLedger({
    directory: '/ledger',
    now: () => NOW,
    randomUUID: () => EVALUATION_ID,
    fs: fakeFs,
  });

  assert.equal((await ledger.recordEvaluation({ input: input(), evaluation: evaluation() })).status, 'not_recorded');
  assert.equal(chmodCalls, 0);
});

test('retention checks files sequentially to bound descriptor pressure', async () => {
  let activeChecks = 0;
  let maximumChecks = 0;
  const oldEntries = Array.from({ length: 40 }, (_, index) => ({
    name: `outcomes-2026-08-${String(index + 1).padStart(2, '0')}.jsonl`,
  }));
  const fakeFs = {
    async lstat(filename) {
      if (filename === '/ledger') return fakeStats({ kind: 'directory', mode: 0o700 });
      if (filename.endsWith('outcomes-2026-09-30.jsonl')) {
        throw Object.assign(new Error('missing'), { code: 'ENOENT' });
      }
      activeChecks += 1;
      maximumChecks = Math.max(maximumChecks, activeChecks);
      await new Promise((resolve) => setImmediate(resolve));
      activeChecks -= 1;
      return fakeStats({ kind: 'file', mode: 0o600 });
    },
    async readdir() { return oldEntries; },
    async unlink() {},
    async open() {
      return {
        async chmod() {},
        async stat() { return fakeStats({ kind: 'file', mode: 0o600 }); },
        async write(line) { return { bytesWritten: Buffer.byteLength(line, 'utf8') }; },
        async close() {},
      };
    },
  };
  const ledger = createOutcomeLedger({
    directory: '/ledger',
    now: () => NOW,
    randomUUID: () => EVALUATION_ID,
    fs: fakeFs,
  });

  assert.equal((await ledger.recordEvaluation({ input: input(), evaluation: evaluation() })).status, 'recorded');
  assert.equal(maximumChecks, 1);
});

test('rejects wrong ownership or insecure mode without exposing the path', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'jev-ledger-insecure-'));
  await chmod(directory, 0o755);
  const ledger = createOutcomeLedger({ directory, now: () => NOW, randomUUID: () => EVALUATION_ID });
  const status = await ledger.recordEvaluation({ input: input(), evaluation: evaluation() });
  assert.deepEqual(status, { status: 'not_recorded', reason: 'disabled_or_unavailable' });
  assert.equal(JSON.stringify(status).includes(directory), false);
});

test('file at 5000000 bytes does not receive another event', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'jev-ledger-size-'));
  await chmod(directory, 0o700);
  const file = path.join(directory, 'outcomes-2026-09-30.jsonl');
  await writeFile(file, '', { mode: 0o600 });
  await truncate(file, 5_000_000);
  const ledger = createOutcomeLedger({ directory, now: () => NOW, randomUUID: () => EVALUATION_ID });
  assert.equal((await ledger.recordEvaluation({ input: input(), evaluation: evaluation() })).status, 'not_recorded');
  assert.equal((await stat(file)).size, 5_000_000);
});

test('retention removes only matching files strictly older than 30 UTC days', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'jev-ledger-retention-'));
  await chmod(directory, 0o700);
  for (const name of ['outcomes-2026-08-31.jsonl', 'outcomes-2026-09-01.jsonl', 'notes.jsonl']) {
    await writeFile(path.join(directory, name), '', { mode: 0o600 });
  }
  const ledger = createOutcomeLedger({ directory, now: () => NOW, randomUUID: () => EVALUATION_ID });
  assert.equal((await ledger.recordEvaluation({ input: input(), evaluation: evaluation() })).status, 'recorded');
  await assert.rejects(access(path.join(directory, 'outcomes-2026-08-31.jsonl')));
  await access(path.join(directory, 'outcomes-2026-09-01.jsonl'));
  await access(path.join(directory, 'notes.jsonl'));
});

test('concurrent child writers produce complete parseable JSON lines', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'jev-ledger-concurrent-'));
  await chmod(directory, 0o700);
  const child = new URL('./fixtures/outcome-ledger-child.mjs', import.meta.url).pathname;
  await Promise.all(Array.from({ length: 4 }, (_, index) => (
    execFileAsync(process.execPath, [child, directory, String(index)])
  )));
  const text = await readFile(path.join(directory, 'outcomes-2026-09-30.jsonl'), 'utf8');
  const lines = text.trim().split('\n');
  assert.equal(lines.length, 100);
  for (const line of lines) assert.equal(JSON.parse(line).recordType, 'evaluation');
});

function fakeStats({ kind, mode, uid = process.getuid() }) {
  return {
    uid,
    mode,
    size: 0,
    isDirectory: () => kind === 'directory',
    isFile: () => kind === 'file',
    isSymbolicLink: () => false,
  };
}
