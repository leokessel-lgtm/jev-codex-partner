# Security Policy

## Reporting a vulnerability

Report security concerns privately to the repository owner through an existing trusted channel. Include the affected version, impact, reproduction steps and a minimal redacted example. Do not put credentials, private payloads or exploitable details in a public issue.

## Security boundary

- Evaluation payloads leave the local machine through Vercel AI Gateway and may be billable.
- `AI_GATEWAY_API_KEY`, Keychain values, tokens and private records must never be committed, logged or included in evaluation state.
- Private and sensitive transfers require approval for the exact outgoing fields and purpose.
- The `evaluate` MCP tool remains prompted and its result is advisory only.
- Repository content is world-readable. Public visibility makes secret scanning and data minimisation mandatory release controls.

Only the current `main` branch is supported. Security fixes are not promised for historical copies.
