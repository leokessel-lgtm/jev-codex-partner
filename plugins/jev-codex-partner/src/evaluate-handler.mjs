import { sanitiseText } from './error-sanitisation.mjs';
import { createGatewayClient } from './gateway-client.mjs';
import { validateEvaluateInput } from './input-validation.mjs';
import { normaliseGatewayResponse } from './output-normalisation.mjs';

export async function handleEvaluate(raw, deps = {}, { signal } = {}) {
  try {
    const checked = validateEvaluateInput(raw);
    if (!checked.ok) return failure('invalid_input', checked.errors, false);
    const gateway = deps.gatewayClient ?? createGatewayClient(deps);
    const response = await gateway.evaluate({
      providerPayload: checked.providerPayload,
      signal,
    });
    const evaluation = normaliseGatewayResponse(response.raw, {
      questions: checked.value.questions,
      durationMs: response.durationMs,
      attempts: response.attempts,
      dataClassification: checked.value.data_classification,
      gatewayRequestId: response.requestId,
    });
    return success(evaluation);
  } catch (error) {
    return failureFrom(error);
  }
}

function success(evaluation) {
  return result({ ok: true, evaluation });
}

function failure(code, message, retryable, optional = {}) {
  return result({
    ok: false,
    error: { code, message, retryable, ...optional },
  }, true);
}

function failureFrom(error) {
  const code = typeof error?.code === 'string'
    ? error.code
    : error?.name === 'InvalidJevResponseError'
      ? 'invalid_gateway_response'
      : 'evaluation_failed';
  const message = typeof error?.message === 'string'
    ? sanitiseText(error.message)
    : 'Evaluation failed.';
  const optional = {};
  if (Number.isInteger(error?.status)) optional.status = error.status;
  if (typeof error?.providerRequestId === 'string') {
    optional.providerRequestId = sanitiseText(error.providerRequestId);
  }
  if (Number.isInteger(error?.attempts) && error.attempts >= 0) optional.attempts = error.attempts;
  return failure(code, message, error?.retryable === true, optional);
}

function result(envelope, isError = false) {
  const callToolResult = {
    content: [{ type: 'text', text: JSON.stringify(envelope) }],
    structuredContent: envelope,
  };
  if (isError) callToolResult.isError = true;
  return callToolResult;
}
