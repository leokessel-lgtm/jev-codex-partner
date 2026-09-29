# Architecture and data flow

This repository is a Codex marketplace containing one Node.js MCP plugin. The marketplace manifest points to `plugins/jev-codex-partner`; the plugin manifest exposes its skills and `.mcp.json` server configuration.

## Overview

```text
Codex
  -> prompted evaluate tool
  -> local schema, size and credential checks
  -> HTTPS request through Vercel AI Gateway
  -> TypeSafe JEV
  -> local response-size and typed-output validation
  -> optional owner-only local evaluation receipt
  -> advisory MCP result

Codex
  -> prompted record_outcome tool
  -> strict local schema validation
  -> owner-only local outcome receipt
  -> no network request
```

The tools accept only the fields defined in [`src/contracts.mjs`](../plugins/jev-codex-partner/src/contracts.mjs). The external evaluation request contains exactly `model`, `state`, `questions` and `providerOptions`. `purpose`, `data_classification`, `sensitive_transfer_approved`, `use_case_id`, `request_metadata` and `ledger` are validated locally but are not transmitted. The provider does not receive arbitrary repository contents unless a user includes that material in the approved `state` or `questions`.

When `JEV_OUTCOME_LEDGER_DIR` is configured and an evaluation explicitly opts in, the server appends allow-listed aggregate metadata to a daily UTC JSONL file. It does not serialise raw request or response objects. `record_outcome` uses the same local writer for a strict enumerated event and never constructs a gateway client.

## Evaluation Mechanisms

- **Boolean:** true or false, with optional definitions for both outcomes.
- **Choice:** one label from two or more supplied alternatives.
- **Score:** one numeric position on a supplied ordered rubric.

## Observed gateway response contract

On 26 September 2026, one explicitly authorised synthetic request sent Boolean, Choice and Score questions together through the raw `/v1/evaluate` endpoint. The response keyed each answer by the submitted question ID:

- Boolean returned `probability`.
- Choice returned the declared criterion key in `choice`, an object-valued `probabilities` distribution keyed by criterion, and optional `confidence`.
- Score returned a fractional `score`, an object-valued `probabilities` distribution keyed by zero-based rubric index, and optional `confidence`.

The plugin maps provider `choice` and `score` into its stable local `value` field and maps Score probability keys into rubric order. It continues to reject undeclared Choice keys, unexpected Score keys, invalid probability values and incomplete distributions. The de-identified observed structure is retained in [`jev-live-contract-v1.json`](../plugins/jev-codex-partner/test/fixtures/jev-live-contract-v1.json); volatile identifiers and timings are synthetic fixture values.

## Network Architecture

The endpoint and model are fixed in the local contracts. The gateway request disallows prompt training. Private and sensitive classifications additionally request zero-data-retention routing. Those requested options do not prove provider availability or establish compliance.

The client enforces request and response byte limits, rejects credential-shaped input, does not follow redirects, bounds retries and timeouts, and validates the returned typed probabilities before presenting them to Codex.

## Canonical sources

- [`src/contracts.mjs`](../plugins/jev-codex-partner/src/contracts.mjs): endpoint, model, request shape and limits.
- [`src/outcome-ledger.mjs`](../plugins/jev-codex-partner/src/outcome-ledger.mjs): local event allow-list, owner-only append controls, rotation and retention.
- [`skills/jev-codex-partner/SKILL.md`](../plugins/jev-codex-partner/skills/jev-codex-partner/SKILL.md): selection and interpretation rules.
- [`skills/jev-evidence-evaluation/SKILL.md`](../plugins/jev-codex-partner/skills/jev-evidence-evaluation/SKILL.md): Boolean-only evidence evaluation discovery, suppression and provenance rules.
- [`selection-and-governance.md`](../plugins/jev-codex-partner/skills/jev-codex-partner/references/selection-and-governance.md): transfer and authority controls.
- Tests under [`test/`](../plugins/jev-codex-partner/test/): current executable evidence.
