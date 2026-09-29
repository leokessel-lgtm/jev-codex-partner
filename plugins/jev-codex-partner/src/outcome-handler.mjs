import { validateRecordOutcomeInput } from './input-validation.mjs';

export async function handleRecordOutcome(raw, deps = {}) {
  const checked = validateRecordOutcomeInput(raw);
  if (!checked.ok) return failure('invalid_input', checked.errors);

  try {
    if (typeof deps.outcomeLedger?.recordOutcome !== 'function') return unavailable();
    const outcome = await deps.outcomeLedger.recordOutcome(checked.value);
    if (outcome?.status !== 'recorded') return unavailable();
    return result({ ok: true, outcome });
  } catch {
    return unavailable();
  }
}

function unavailable() {
  return failure('ledger_unavailable', 'Outcome ledger is disabled or unavailable.');
}

function failure(code, message) {
  return result({
    ok: false,
    error: { code, message, retryable: false },
  }, true);
}

function result(envelope, isError = false) {
  const callToolResult = {
    content: [{ type: 'text', text: JSON.stringify(envelope) }],
    structuredContent: envelope,
  };
  if (isError) callToolResult.isError = true;
  return callToolResult;
}
