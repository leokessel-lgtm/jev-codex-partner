import { randomUUID as systemRandomUUID } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import fsPromises from 'node:fs/promises';
import path from 'node:path';

const MAX_EVENT_BYTES = 4096;
const MAX_FILE_BYTES = 5_000_000;
const DIRECTORY_MODE = 0o700;
const FILE_MODE = 0o600;
const LEDGER_FILENAME = /^outcomes-(\d{4}-\d{2}-\d{2})\.jsonl$/;
const NOT_RECORDED = Object.freeze({
  status: 'not_recorded',
  reason: 'disabled_or_unavailable',
});

export function createOutcomeLedger({
  directory,
  now = () => new Date(),
  randomUUID = systemRandomUUID,
  fs = fsPromises,
} = {}) {
  async function append(event) {
    if (typeof directory !== 'string' || directory.length === 0) return NOT_RECORDED;
    const line = `${JSON.stringify(event)}\n`;
    if (Buffer.byteLength(line, 'utf8') > MAX_EVENT_BYTES) return NOT_RECORDED;
    try {
      const owner = currentOwner();
      await ensureDirectory(fs, directory, owner);
      const timestamp = now();
      await removeExpiredFiles(fs, directory, timestamp, owner);
      const filename = `outcomes-${timestamp.toISOString().slice(0, 10)}.jsonl`;
      await appendSecurely(fs, path.join(directory, filename), line, owner);
      return null;
    } catch {
      return NOT_RECORDED;
    }
  }

  return {
    async recordEvaluation({ input, evaluation }) {
      const recordId = randomUUID();
      const failed = await append(evaluationEvent({ input, evaluation, recordId, recordedAt: now() }));
      return failed ?? { status: 'recorded', recordId };
    },
    async recordOutcome(input) {
      const eventId = randomUUID();
      const failed = await append({
        schemaVersion: 1,
        recordType: 'outcome',
        eventId,
        recordedAt: now().toISOString(),
        recordId: input.record_id,
        action: input.action,
        override: input.override,
        outcome: input.outcome,
      });
      return failed ?? { status: 'recorded', eventId };
    },
  };
}

function currentOwner() {
  if (typeof process.getuid !== 'function') throw new Error('POSIX ownership unavailable');
  return process.getuid();
}

async function ensureDirectory(fs, directory, owner) {
  let created = false;
  try {
    await fs.lstat(directory);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    const made = await fs.mkdir(directory, { recursive: true, mode: DIRECTORY_MODE });
    created = made !== undefined;
  }
  if (created) await fs.chmod(directory, DIRECTORY_MODE);
  const stats = await fs.lstat(directory);
  assertSecure(stats, { owner, mode: DIRECTORY_MODE, kind: 'directory' });
}

async function appendSecurely(fs, filename, line, owner) {
  let existed = true;
  let priorStats;
  try {
    priorStats = await fs.lstat(filename);
    assertSecure(priorStats, { owner, mode: FILE_MODE, kind: 'file' });
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    existed = false;
  }

  const baseFlags = fsConstants.O_APPEND
    | fsConstants.O_CREAT
    | fsConstants.O_WRONLY
    | (fsConstants.O_NOFOLLOW ?? 0);
  let created = !existed;
  let handle;
  try {
    handle = await fs.open(
      filename,
      baseFlags | (created ? fsConstants.O_EXCL : 0),
      FILE_MODE,
    );
  } catch (error) {
    if (!created || error?.code !== 'EEXIST') throw error;
    priorStats = await fs.lstat(filename);
    assertSecure(priorStats, { owner, mode: FILE_MODE, kind: 'file' });
    handle = await fs.open(filename, baseFlags, FILE_MODE);
    created = false;
  }
  try {
    let stats = await handle.stat();
    assertIdentity(stats, { owner, kind: 'file' });
    if (created) {
      await handle.chmod(FILE_MODE);
      stats = await handle.stat();
    }
    assertSecure(stats, { owner, mode: FILE_MODE, kind: 'file' });
    if (!created && priorStats && (stats.dev !== priorStats.dev || stats.ino !== priorStats.ino)) {
      throw new Error('Ledger target changed during open');
    }
    if (stats.size >= MAX_FILE_BYTES) throw new Error('Ledger file limit reached');
    const result = await handle.write(line, null, 'utf8');
    if (result.bytesWritten !== Buffer.byteLength(line, 'utf8')) {
      throw new Error('Incomplete ledger append');
    }
  } finally {
    await handle.close();
  }
}

function assertSecure(stats, { owner, mode, kind }) {
  assertIdentity(stats, { owner, kind });
  if ((stats.mode & 0o777) !== mode) throw new Error('Insecure ledger storage');
}

function assertIdentity(stats, { owner, kind }) {
  const correctKind = kind === 'directory' ? stats.isDirectory() : stats.isFile();
  if (stats.isSymbolicLink() || !correctKind || stats.uid !== owner) {
    throw new Error('Insecure ledger storage');
  }
}

async function removeExpiredFiles(fs, directory, timestamp, owner) {
  const cutoff = new Date(Date.UTC(
    timestamp.getUTCFullYear(),
    timestamp.getUTCMonth(),
    timestamp.getUTCDate() - 29,
  ));
  let entries;
  try {
    entries = await fs.readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const match = LEDGER_FILENAME.exec(entry.name);
    if (!match || match[1] >= cutoff.toISOString().slice(0, 10)) continue;
    try {
      const filename = path.join(directory, entry.name);
      const stats = await fs.lstat(filename);
      assertSecure(stats, { owner, mode: FILE_MODE, kind: 'file' });
      await fs.unlink(filename);
    } catch {
      // Retention is best effort and must not block a safe current append.
    }
  }
}

function evaluationEvent({ input, evaluation, recordId, recordedAt }) {
  const summaries = Object.values(evaluation.answers).map(answerSummary);
  const probabilities = summaries.map(({ probability }) => probability);
  const confidences = summaries.flatMap(({ confidence }) => (
    confidence === undefined ? [] : [confidence]
  ));
  return {
    schemaVersion: 1,
    recordType: 'evaluation',
    recordId,
    recordedAt: recordedAt.toISOString(),
    ...(input.ledger.correlation_id === undefined
      ? {}
      : { correlationId: input.ledger.correlation_id }),
    dataClassification: evaluation.dataClassification,
    questionTypes: [...new Set(Object.values(input.questions).map(({ type }) => type))].sort(),
    questionCount: Object.keys(input.questions).length,
    answerSummary: {
      probability: aggregate(probabilities),
      ...(confidences.length === 0 ? {} : { confidence: aggregate(confidences) }),
      choiceOptionCounts: summaries.flatMap(({ choiceOptionCount }) => (
        choiceOptionCount === undefined ? [] : [choiceOptionCount]
      )),
      scoreRubricSizes: summaries.flatMap(({ scoreRubricSize }) => (
        scoreRubricSize === undefined ? [] : [scoreRubricSize]
      )),
    },
    provider: evaluation.provider,
    requestedModel: evaluation.requestedModel,
    resolvedModel: evaluation.resolvedModel,
    pluginVersion: evaluation.pluginVersion,
    durationMs: evaluation.durationMs,
    attempts: evaluation.attempts,
    usage: { ...evaluation.usage },
    cost: { ...evaluation.cost },
  };
}

function answerSummary(answer) {
  if (answer.type === 'boolean') {
    return { probability: answer.probability, confidence: answer.confidence };
  }
  if (answer.type === 'choice') {
    return {
      probability: Math.max(...Object.values(answer.probabilities)),
      confidence: answer.confidence,
      choiceOptionCount: Object.keys(answer.probabilities).length,
    };
  }
  return {
    probability: Math.max(...answer.probabilities),
    confidence: answer.confidence,
    scoreRubricSize: answer.probabilities.length,
  };
}

function aggregate(values) {
  return {
    count: values.length,
    min: Math.min(...values),
    max: Math.max(...values),
    mean: values.reduce((sum, value) => sum + value, 0) / values.length,
  };
}
