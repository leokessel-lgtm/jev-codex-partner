import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import process from 'node:process';

import { handleEvaluate } from '../src/evaluate-handler.mjs';
import { createGatewayClient } from '../src/gateway-client.mjs';

export function scoreCases(cases, results, {
  probabilityBands = [0, 0.5, 0.75, 1],
  reviewThreshold = 0.75,
} = {}) {
  validateSynthetic(cases);
  const byId = new Map(results.map((result) => [result.id, result]));
  let answered = 0;
  let correct = 0;
  const failures = { total: 0, provider: 0, validation: 0, missingAnswer: 0 };
  let reviewCount = 0;
  let brierSum = 0;
  let brierCount = 0;
  let scoreMaeSum = 0;
  let scoreCount = 0;
  let cost = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  const latencies = [];
  const reliability = normaliseBands(probabilityBands).map(({ lower, upper }) => ({ lower, upper, count: 0, hits: 0, observedHitRate: 0 }));

  for (const item of cases) {
    const result = byId.get(item.id);
    const questionId = Object.keys(item.expected ?? {})[0];
    const expected = item.expected?.[questionId];
    const question = item.questions?.[questionId] ?? {};
    const answer = extractAnswer(result, questionId);
    if (result?.latencyMs !== undefined) latencies.push(Number(result.latencyMs));
    inputTokens += Number(result?.usage?.inputTokens ?? 0);
    outputTokens += Number(result?.usage?.outputTokens ?? 0);
    cost += Number(result?.cost?.cost ?? 0);
    if (result?.failureCategory === 'provider' || result?.failureCategory === 'validation') {
      failures[result.failureCategory] += 1;
      failures.total += 1;
      reviewCount += 1;
      continue;
    }
    const predicted = predictedValue(answer, question);
    if (answer === undefined || answer === null || predicted === undefined) {
      failures.missingAnswer += 1;
      failures.total += 1;
      reviewCount += 1;
      continue;
    }
    answered += 1;
    const hit = predicted === expected;
    if (hit) correct += 1;
    const confidence = confidenceForPrediction(answer, predicted, question);
    const brier = brierContribution(answer, expected, question);
    if (brier !== undefined) {
      brierSum += brier;
      brierCount += 1;
    }
    if (confidence !== undefined && (question.type === 'boolean' || question.type === 'choice')) {
      const band = reliability.find((candidate) => confidence >= candidate.lower && confidence <= candidate.upper && (confidence < candidate.upper || candidate.upper === 1));
      if (band) {
        band.count += 1;
        if (hit) band.hits += 1;
      }
    }
    if (question.type === 'score') {
      scoreMaeSum += Math.abs(Number(answer.value) - Number(expected));
      scoreCount += 1;
    }
    if (confidence === undefined || confidence < reviewThreshold) reviewCount += 1;
  }
  for (const band of reliability) band.observedHitRate = band.count ? band.hits / band.count : 0;
  latencies.sort((a, b) => a - b);
  return {
    accuracy: cases.length ? correct / cases.length : 0,
    answeredAccuracy: answered ? correct / answered : 0,
    labelledCases: cases.length,
    answeredCases: answered,
    brierScore: brierCount ? brierSum / brierCount : 0,
    brierMethod: 'Boolean binary; Choice sum across classes; mean across answered Boolean and Choice questions.',
    scoreMae: scoreCount ? scoreMaeSum / scoreCount : 0,
    reviewRate: cases.length ? reviewCount / cases.length : 0,
    reliability,
    latency: { count: latencies.length, meanMs: latencies.length ? latencies.reduce((sum, value) => sum + value, 0) / latencies.length : 0, p95Ms: percentile(latencies, 0.95) },
    usage: { inputTokens, outputTokens },
    cost,
    failures,
  };
}

export async function runEvaluation({ fixturePath, live = false, confirmSynthetic = false, gatewayClient } = {}) {
  const bytes = await readFile(fixturePath);
  const cases = JSON.parse(bytes);
  validateSynthetic(cases);
  const fixtureSha256 = createHash('sha256').update(bytes).digest('hex');
  if (live && !confirmSynthetic) throw new CliUsageError('Live execution requires --confirm-synthetic.');
  if (!live) {
    return {
      cases: cases.length,
      fixtureSha256,
      networkActivity: { evaluationCalls: 0, httpAttempts: 0 },
      metrics: scoreCases(cases, []),
    };
  }
  let evaluationCalls = 0;
  let httpAttempts = 0;
  const baseGateway = gatewayClient ?? createGatewayClient({ apiKey: process.env.AI_GATEWAY_API_KEY });
  const gateway = {
    async evaluate(request) {
      evaluationCalls += 1;
      try {
        const response = await baseGateway.evaluate(request);
        httpAttempts += Number(response.attempts ?? 0);
        return response;
      } catch (error) {
        httpAttempts += Number(error?.attempts ?? 0);
        throw error;
      }
    },
  };
  const results = [];
  for (const item of cases.slice(0, cases.length)) {
    const result = await handleEvaluate({
      purpose: item.purpose,
      state: item.state,
      questions: item.questions,
      data_classification: 'synthetic',
      sensitive_transfer_approved: true,
    }, { gatewayClient: gateway });
    const envelope = result.structuredContent;
    if (envelope.ok) {
      results.push({
        id: item.id,
        answers: envelope.evaluation.answers,
        latencyMs: envelope.evaluation.durationMs,
        usage: envelope.evaluation.usage,
        cost: envelope.evaluation.cost,
      });
    } else {
      results.push({
        id: item.id,
        failureCategory: envelope.error.code === 'invalid_input' ? 'validation' : 'provider',
      });
    }
  }
  return {
    cases: cases.length,
    fixtureSha256,
    networkActivity: { evaluationCalls, httpAttempts },
    metrics: scoreCases(cases, results),
  };
}

function validateSynthetic(cases) {
  if (!Array.isArray(cases)) throw new Error('Fixture must be an array of synthetic cases.');
  for (const item of cases) if (item?.classification !== 'synthetic') throw new Error('Only synthetic cases are permitted.');
}
function extractAnswer(result, questionId) {
  const answer = result?.answers?.[questionId];
  if (answer && typeof answer === 'object') return answer;
  if (answer === undefined || answer === null) return undefined;
  return { value: answer };
}
function predictedValue(answer, question) {
  if (answer === undefined || answer === null) return undefined;
  if (question.type === 'boolean' && Number.isFinite(answer.probability)) {
    return answer.probability >= 0.5;
  }
  return answer.value;
}
function brierContribution(answer, expected, question) {
  if (question.type === 'boolean' && Number.isFinite(answer.probability)) {
    return (answer.probability - (expected ? 1 : 0)) ** 2;
  }
  if (question.type === 'choice' && answer.probabilities && Object.hasOwn(answer.probabilities, expected)) {
    return Object.entries(answer.probabilities).reduce((sum, [option, probability]) => (
      sum + (Number(probability) - (option === expected ? 1 : 0)) ** 2
    ), 0);
  }
  return undefined;
}
function confidenceForPrediction(answer, predicted, question) {
  if (Number.isFinite(answer.confidence)) return answer.confidence;
  if (question.type === 'boolean' && Number.isFinite(answer.probability)) {
    return Math.max(answer.probability, 1 - answer.probability);
  }
  if (answer.probabilities && predicted in answer.probabilities) {
    return Number(answer.probabilities[predicted]);
  }
  return undefined;
}
function normaliseBands(bands) {
  if (
    !Array.isArray(bands)
    || bands.length < 2
    || bands.some((value) => !Number.isFinite(value) || value < 0 || value > 1)
    || bands.some((value, index) => index > 0 && value <= bands[index - 1])
  ) {
    throw new TypeError('Probability bands must be finite, strictly increasing values from zero to one.');
  }
  return bands.slice(0, -1).map((lower, index) => ({ lower, upper: bands[index + 1] }));
}
function percentile(values, p) { return values.length ? values[Math.min(values.length - 1, Math.ceil(values.length * p) - 1)] : 0; }
export class CliUsageError extends Error { constructor(message) { super(message); this.code = 2; } }

async function main() {
  const args = process.argv.slice(2);
  const fixturePath = args.find((arg) => !arg.startsWith('--'));
  if (!fixturePath) throw new CliUsageError('A fixture path is required.');
  const summary = await runEvaluation({ fixturePath, live: args.includes('--live'), confirmSynthetic: args.includes('--confirm-synthetic') });
  process.stdout.write(`cases: ${summary.cases}\nfixtureSha256: ${summary.fixtureSha256}\nevaluationCalls: ${summary.networkActivity.evaluationCalls}\nhttpAttempts: ${summary.networkActivity.httpAttempts}\n`);
  if (args.includes('--live')) process.stdout.write(`metrics: ${JSON.stringify(summary.metrics)}\n`);
}

if (import.meta.url === `file://${process.argv[1]}`) main().catch((error) => { process.stderr.write(`${error.message}\n`); process.exitCode = error.code === 2 ? 2 : 1; });
