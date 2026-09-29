# JEV Codex Partner Plugin

This package exposes two prompted MCP tools and two focused skills. `evaluate` sends a bounded Boolean, Choice or Score judgement to TypeSafe JEV through Vercel AI Gateway and may be billable. `record_outcome` writes an enumerated outcome to an optional local ledger and makes no network request. `jev-evidence-evaluation` covers Boolean-only claim support, citation support and semantic equivalence with fail-closed provenance controls.

## Local Source

This npm package is marked private and must not be published to npm. The source repository is public and distributes the plugin through the repository marketplace manifest at [`../../.agents/plugins/marketplace.json`](../../.agents/plugins/marketplace.json).

## Development

Install and run local checks with Node.js 20 or later:

```bash
npm ci
npm run check
```

Preview the bundled synthetic benchmarks with `npm run benchmark:preview`. `npm run benchmark:live -- --confirm-synthetic` makes external requests and must be deliberately confirmed; it never belongs in CI.

## Usage

See the [root README](../../README.md) for installation. General selection, transfer and interpretation boundaries remain canonical in [`skills/jev-codex-partner/SKILL.md`](skills/jev-codex-partner/SKILL.md) and its linked references. Evidence-specific automatic selection and privacy controls are defined in [`skills/jev-evidence-evaluation/SKILL.md`](skills/jev-evidence-evaluation/SKILL.md).

## Optional outcome ledger

The privacy-safe outcome ledger is opt-in. Set `JEV_OUTCOME_LEDGER_DIR` in the MCP process environment to an absolute directory chosen by the operator, then restart that MCP process. Leaving the variable absent or empty keeps recording disabled and does not affect ordinary evaluation.

An evaluation is recorded only when its validated input includes `"ledger": { "record": true }`. An optional `correlation_id` must be opaque. Never put names, descriptions, account identifiers or other descriptive correlation data in it. Do not send raw state, prompts, question text, semantic labels, amounts or credentials to the ledger.

The ledger stores privacy-minimised telemetry in owner-only daily JSONL files. It retains 30 UTC days including the current day, refuses an append when the current file is already 5,000,000 bytes, and returns only generic unavailable status on a storage failure. `record_outcome` accepts only a prior record UUID and enumerated action, override and outcome values. It is prompted and must not be automated.

Keep source evidence, JEV output, ledger telemetry and the human decision separate. A ledger record is operational evidence that an append completed, not proof that the advice was correct, an outcome occurred, or an action was authorised.
