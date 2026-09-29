---
name: jev-evidence-evaluation
description: Use when evaluating whether supplied evidence supports a claim or citation, or whether two supplied statements are semantically equivalent; applies Boolean-only JEV judgement with privacy-first transfer controls and explicit local-only overrides.
---

# JEV Evidence Evaluation

Use this skill automatically for a bounded claim-to-evidence support check, citation support check or semantic equivalence check when the user has supplied the text to compare and a probability-bearing Boolean judgement would add value.

## Select and disclose

1. Honour an instruction such as `no JEV` or `local only` by suppressing the external call and completing the task locally.
2. Confirm that the task is an eligible Boolean-only evaluation. Define one proposition whose `true` and `false` meanings are clear. Do not use Choice or Score through this skill.
3. Classify the proposed state before any call. Only automatically send content that is deterministically public or synthetic. Content is deterministically public only when the exact text was retrieved in the current task from a source that is publicly accessible without authentication, or the user explicitly identifies the exact supplied text as published public content and it contains no private additions. A public topic or URL alone is insufficient. Pasted, paraphrased or workspace-summarised text is ambiguous unless its public provenance is established. Synthetic content must be clearly fictional or test data and contain no real private details.
4. Before an eligible public or synthetic call, give this brief visible notice: `JEV fits this evidence check. An external, potentially billable TypeSafe JEV evaluation will run through Vercel AI Gateway.`
5. Treat workspace-derived content and content with ambiguous provenance as private by default. Before sending it, obtain exact-transfer approval at action time for the precise fields, TypeSafe JEV through Vercel AI Gateway as the destination, and the evaluation purpose. Approval for a general workflow is insufficient.
6. Send only the minimal state needed for the proposition. Follow the canonical [selection and governance](../jev-codex-partner/references/selection-and-governance.md) and [question design](../jev-codex-partner/references/question-design.md) controls.

## Boolean question patterns

- Claim support: `Given only the supplied evidence, is the bounded claim supported?`
- Citation support: `Does the supplied source passage support the cited statement without adding a material claim?`
- Semantic equivalence: `Do these two supplied statements have materially equivalent meaning for the stated context?`

State the relevant acceptance criterion. Ask one proposition, or a bounded batch of independent propositions, and preserve the returned probability and provider receipt fields.

## Exclusions and authority

Do not use this skill for generation, research, arithmetic, counting, dates, planning, current facts, deterministic checks, open-ended interpretation or consequential approvals. Use ordinary code or primary-source verification where that is more reliable.

JEV output is advisory-only. It does not prove a claim, validate a citation as authoritative, approve publication or action, or create authority. Keep source evidence, JEV output and the human decision distinct. Apply no universal probability threshold, make no authority expansion, and do not trigger another provider or consequential action from the result.
