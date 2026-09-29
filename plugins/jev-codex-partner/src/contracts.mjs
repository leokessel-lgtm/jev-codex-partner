export const GATEWAY_URL = 'https://ai-gateway.vercel.sh/v1/evaluate';
export const MODEL_ID = 'typesafe-ai/jev';
export const PLUGIN_VERSION = '0.1.9';
export const PROVIDER_OPTIONS = Object.freeze({
  gateway: { disallowPromptTraining: true, only: ['typesafe-ai'] },
});
export const ZDR_PROVIDER_OPTIONS = Object.freeze({
  gateway: { zeroDataRetention: true, only: ['typesafe-ai'] },
});
export const MAX_REQUEST_BYTES = 64_000;
export const MAX_STATE_QUESTION_BYTES = 32_000;
export const MAX_RESPONSE_BYTES = 1_048_576;

const QUESTION_ID_PATTERN = '^[A-Za-z][A-Za-z0-9_-]{0,63}$';
export const LEDGER_CORRELATION_ID_PATTERN = '^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$';
const UUID_PATTERN = '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$';
const NON_EMPTY_TEXT = { type: 'string', minLength: 1 };

const booleanQuestion = {
  type: 'object',
  additionalProperties: false,
  required: ['type', 'instructions'],
  properties: {
    type: { const: 'boolean' },
    instructions: NON_EMPTY_TEXT,
    criteria: {
      type: 'object',
      additionalProperties: false,
      required: ['true', 'false'],
      properties: { true: NON_EMPTY_TEXT, false: NON_EMPTY_TEXT },
    },
  },
};

const choiceQuestion = {
  type: 'object',
  additionalProperties: false,
  required: ['type', 'instructions', 'criteria'],
  properties: {
    type: { const: 'choice' },
    instructions: NON_EMPTY_TEXT,
    criteria: {
      type: 'object',
      minProperties: 2,
      maxProperties: 255,
      propertyNames: { minLength: 1 },
      additionalProperties: NON_EMPTY_TEXT,
    },
  },
};

const scoreQuestion = {
  type: 'object',
  additionalProperties: false,
  required: ['type', 'instructions', 'criteria'],
  properties: {
    type: { const: 'score' },
    instructions: NON_EMPTY_TEXT,
    criteria: { type: 'array', minItems: 2, maxItems: 10, items: NON_EMPTY_TEXT },
  },
};

export const EVALUATE_INPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'purpose',
    'state',
    'questions',
    'data_classification',
    'sensitive_transfer_approved',
  ],
  properties: {
    purpose: NON_EMPTY_TEXT,
    state: {
      anyOf: [
        NON_EMPTY_TEXT,
        { type: 'object' },
        { type: 'array' },
      ],
    },
    questions: {
      type: 'object',
      minProperties: 1,
      propertyNames: { pattern: QUESTION_ID_PATTERN },
      additionalProperties: { oneOf: [booleanQuestion, choiceQuestion, scoreQuestion] },
    },
    data_classification: {
      enum: ['synthetic', 'public', 'private', 'sensitive'],
    },
    sensitive_transfer_approved: { type: 'boolean' },
    use_case_id: { type: 'string', minLength: 1, maxLength: 255 },
    request_metadata: { type: 'object', additionalProperties: true },
    ledger: {
      type: 'object',
      additionalProperties: false,
      required: ['record'],
      properties: {
        record: { const: true },
        correlation_id: { type: 'string', pattern: LEDGER_CORRELATION_ID_PATTERN },
      },
    },
  },
};

export const RECORD_OUTCOME_INPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['record_id', 'action', 'override', 'outcome'],
  properties: {
    record_id: { type: 'string', pattern: UUID_PATTERN },
    action: { enum: ['followed', 'overridden', 'deferred', 'no_action'] },
    override: { type: 'boolean' },
    outcome: { enum: ['correct', 'incorrect', 'mixed', 'unknown'] },
  },
};

export const EVALUATE_TOOL = Object.freeze({
  name: 'evaluate',
  description: 'Run one governed Boolean, Choice or Score evaluation with TypeSafe JEV. This makes an external, potentially billable request through Vercel AI Gateway.',
  inputSchema: EVALUATE_INPUT_SCHEMA,
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: true,
  },
});

export const RECORD_OUTCOME_TOOL = Object.freeze({
  name: 'record_outcome',
  description: 'Record an enumerated local outcome for a prior JEV evaluation. This writes only privacy-minimised local telemetry and makes no network request.',
  inputSchema: RECORD_OUTCOME_INPUT_SCHEMA,
  annotations: {
    readOnlyHint: false,
    destructiveHint: false,
    openWorldHint: false,
  },
});
