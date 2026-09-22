import { MODEL_ID } from './contracts.mjs';
import { containsCredentialValue } from './error-sanitisation.mjs';

const PROVIDER_ID = 'typesafe-ai';
const DISTRIBUTION_TOLERANCE = 0.02;
const DECIMAL_COST = /^(?:0|[1-9][0-9]*)(?:\.[0-9]+)?$/u;
const ADVISORY_WARNING = 'JEV output is advisory; typed output does not establish correctness.';
const SAFE_GENERATION_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/u;

export function normaliseGatewayResponse(raw, context) {
  try {
    return normalise(raw, context);
  } catch (error) {
    if (error instanceof InvalidJevResponseError) throw error;
    throw invalid('response structure could not be inspected');
  }
}

function normalise(raw, context) {
  requireRecord(raw, 'response');
  requireRecord(context, 'context');
  requireRecord(context.questions, 'question map');

  if (raw.model !== MODEL_ID) throw invalid('model does not match the requested JEV model');

  const gateway = routingGateway(raw);
  const answers = normaliseAnswers(raw.answers, context.questions);
  const usage = normaliseUsage(raw.usage);
  const cost = normaliseCost(gateway);

  if (
    typeof gateway.generationId !== 'string'
    || !SAFE_GENERATION_ID.test(gateway.generationId)
    || containsCredentialValue(gateway.generationId)
  ) {
    throw invalid('generation ID is missing or unsafe');
  }

  return {
    provider: PROVIDER_ID,
    requestedModel: MODEL_ID,
    resolvedModel: raw.model,
    answers,
    usage,
    cost,
    requestId: gateway.generationId,
    durationMs: context.durationMs,
    attempts: context.attempts,
    dataClassification: context.dataClassification,
    warnings: [ADVISORY_WARNING],
  };
}

function routingGateway(raw) {
  requireRecord(raw.providerMetadata, 'provider metadata');
  const gateway = raw.providerMetadata.gateway;
  requireRecord(gateway, 'gateway metadata');
  requireRecord(gateway.routing, 'routing metadata');

  const expectedRouting = {
    originalModelId: MODEL_ID,
    resolvedProvider: PROVIDER_ID,
    canonicalSlug: MODEL_ID,
    finalProvider: PROVIDER_ID,
  };
  for (const [field, expected] of Object.entries(expectedRouting)) {
    if (gateway.routing[field] !== expected) {
      throw invalid(`routing field ${field} does not match the TypeSafe-only route`);
    }
  }
  return gateway;
}

function normaliseAnswers(rawAnswers, questions) {
  requireRecord(rawAnswers, 'answers');
  const questionIds = Object.keys(questions);
  const answerIds = Object.keys(rawAnswers);
  if (new Set(answerIds).size !== answerIds.length) throw invalid('answer IDs are duplicated');
  if (answerIds.length !== questionIds.length) throw invalid('answer IDs do not match the questions');

  const questionIdSet = new Set(questionIds);
  for (const answerId of answerIds) {
    if (!questionIdSet.has(answerId)) throw invalid('an answer ID was not requested');
  }

  const result = {};
  for (const id of questionIds) {
    if (!Object.hasOwn(rawAnswers, id)) throw invalid('a requested answer is missing');
    const question = questions[id];
    const answer = rawAnswers[id];
    requireRecord(question, 'question');
    requireRecord(answer, 'answer');
    if (answer.type !== question.type) throw invalid('answer type does not match its question');

    if (question.type === 'boolean') {
      result[id] = {
        type: 'boolean',
        probability: probability(answer.probability),
      };
    } else if (question.type === 'choice') {
      result[id] = normaliseChoice(answer, question);
    } else if (question.type === 'score') {
      result[id] = normaliseScore(answer, question);
    } else {
      throw invalid('question type is unsupported');
    }
    addConfidence(result[id], answer);
  }
  return result;
}

function normaliseChoice(answer, question) {
  requireRecord(question.criteria, 'Choice criteria');
  const criteriaIds = Object.keys(question.criteria);
  if (typeof answer.value !== 'string' || !Object.hasOwn(question.criteria, answer.value)) {
    throw invalid('Choice value is outside the criteria');
  }

  requireRecord(answer.probabilities, 'Choice probabilities');
  const probabilityIds = Object.keys(answer.probabilities);
  if (
    probabilityIds.length !== criteriaIds.length
    || probabilityIds.some((id) => !Object.hasOwn(question.criteria, id))
  ) {
    throw invalid('Choice probability keys do not match the criteria');
  }

  const probabilities = Object.fromEntries(
    criteriaIds.map((id) => [id, probability(answer.probabilities[id])]),
  );
  requireDistribution(Object.values(probabilities));
  return { type: 'choice', value: answer.value, probabilities };
}

function normaliseScore(answer, question) {
  if (!Array.isArray(question.criteria)) throw invalid('Score criteria are invalid');
  if (
    !Number.isInteger(answer.value)
    || answer.value < 0
    || answer.value >= question.criteria.length
  ) {
    throw invalid('Score value is outside the criteria range');
  }

  if (
    !Array.isArray(answer.probabilities)
    || answer.probabilities.length !== question.criteria.length
  ) {
    throw invalid('Score probabilities do not match the criteria');
  }
  for (let index = 0; index < question.criteria.length; index += 1) {
    if (!Object.hasOwn(answer.probabilities, index)) {
      throw invalid('Score probabilities do not match the criteria');
    }
  }
  const probabilities = answer.probabilities.map(probability);
  requireDistribution(probabilities);
  return { type: 'score', value: answer.value, probabilities };
}

function addConfidence(output, answer) {
  if (answer.confidence !== undefined) output.confidence = probability(answer.confidence);
}

function probability(value) {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw invalid('probability or confidence is outside zero to one');
  }
  return value;
}

function requireDistribution(values) {
  const sum = values.reduce((total, value) => total + value, 0);
  if (Math.abs(sum - 1) > DISTRIBUTION_TOLERANCE + Number.EPSILON) {
    throw invalid('probability distribution does not sum to one');
  }
}

function normaliseUsage(rawUsage) {
  requireRecord(rawUsage, 'usage');
  const usage = {};
  for (const field of ['inputTokens', 'outputTokens']) {
    const value = rawUsage[field];
    if (!Number.isSafeInteger(value) || value < 0) {
      throw invalid('usage must contain non-negative integer token counts');
    }
    usage[field] = value;
  }
  return usage;
}

function normaliseCost(gateway) {
  const result = {};
  for (const field of ['cost', 'marketCost', 'surchargeCost', 'gatewayCost']) {
    const value = gateway[field];
    if (typeof value !== 'string' || !DECIMAL_COST.test(value)) {
      throw invalid('cost metadata must contain non-negative decimal strings');
    }
    result[field] = value;
  }
  return result;
}

function requireRecord(value, name) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw invalid(`${name} must be an object`);
  }
}

class InvalidJevResponseError extends TypeError {
  constructor(reason) {
    super(`Invalid JEV response: ${reason}.`);
    this.name = 'InvalidJevResponseError';
  }
}

function invalid(reason) {
  return new InvalidJevResponseError(reason);
}
