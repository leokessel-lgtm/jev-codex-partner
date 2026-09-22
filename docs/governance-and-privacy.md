# Governance and Privacy

The JEV Codex Partner repository is public and intentionally unlicensed. Public visibility permits inspection and cloning but does not grant general reuse or redistribution rights.

## Data Transfer and Privacy

The plugin sends exactly `model`, `state`, `questions` and `providerOptions` to TypeSafe JEV through Vercel AI Gateway. This is an external, potentially billable transfer. `purpose`, `data_classification`, `sensitive_transfer_approved`, `use_case_id` and `request_metadata` are validated locally but are not transmitted. The plugin does not automatically send source code, files or repository context.

Classify each payload as `synthetic`, `public`, `private` or `sensitive`. Synthetic and public inputs do not require the sensitive-transfer flag. Private and sensitive inputs require approval at action time for the exact fields, destination and purpose, followed by `sensitive_transfer_approved: true` on that request.

Always minimise the state. Exclude credentials, tokens, passwords, MFA or CAPTCHA material, session identifiers and unrelated personal information.

## Limitations

- Results are advisory and remain separate from source evidence and the human decision.
- A probability is not a universal confidence threshold.
- Results do not grant authority, change permissions, establish compliance or authorise an external action.
- Requested zero-data-retention routing depends on current provider and plan support and is not a compliance guarantee.

## Benchmarking Governance

Dry-run benchmarks are the default to prevent accidental data exfiltration or unexpected billing.
Live synthetic benchmarks must be explicitly confirmed. Never run live benchmarks in continuous integration.

## Repository governance

The plugin code, manifests and governance references are source-of-truth. Tests are current evidence. Benchmark fixtures are synthetic test material. Installed caches, dependencies, local logs and generated run material are excluded from this repository.
