# Selection and governance

## Select JEV when

Choose the partner tool for a bounded Boolean question, a finite Choice classification or routing question, or a Score/rubric assessment. It is useful when the typed probabilities, alternatives or score provide decision support that ordinary prose would not.

Do not select it for generation, open-ended research, maths or arithmetic, counting, dates or date calculations, planning, precision work, questions that ordinary deterministic code can answer reliably, or autonomous consequential decisions. JEV is a classifier and evaluator, not a source of truth or an execution engine.

## Payload and authority controls

- Send only the minimal-state payload required for the stated evaluation. Exclude credentials, passwords, tokens, MFA or CAPTCHA material, session identifiers, and unnecessary personal or sensitive data.
- Private or sensitive payloads require exact-transfer approval at action time. Confirm the precise fields, destination and purpose before sending; do not infer approval from a general instruction or from tool availability.
- Treat the final `evaluate` input and result as the contract. Keep source evidence, the returned result and any human decision distinct.
- Results are advisory-only. They do not grant authority, change permissions, approve a transaction, establish compliance, or authorise an external send, purchase, booking, upload, deletion or deployment.
- Do not automatically run Antigravity, choose a model, retry with a broader payload, or take a consequential action based on a result.
- Do not apply a universal confidence threshold. Explain uncertainty and use the context-specific human review gate instead.

Codex should state why JEV fits before calling it, preserve the returned alternatives/probabilities or score, and avoid inventing reasoning that the partner did not return.

## Optional outcome ledger

The ledger is opt-in and available only when the operator has configured `JEV_OUTCOME_LEDGER_DIR`. Request evaluation recording only when calibration is relevant and the operator has enabled that directory. Do not infer activation, silently add descriptive correlation data or include raw state, prompts, question text, semantic labels, amounts or credentials. Use an opaque correlation ID or omit it.

There is no automatic outcome recording. Call `record_outcome` only after the user has an adequately evidenced outcome and authorises that prompted local mutation. Store only the schema's enumerated action, override and outcome values.

Keep source evidence, JEV output, ledger telemetry and the human decision distinct. Telemetry does not prove correctness, approval, compliance, business impact or authority.
