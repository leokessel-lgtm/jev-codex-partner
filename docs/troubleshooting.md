# Troubleshooting

## Authentication Issues

The plugin first reads `AI_GATEWAY_API_KEY`. On macOS, it falls back to a generic-password item named `codex-jev-partner-ai-gateway` for the current account.

```bash
security add-generic-password -U -a "$(id -un)" -s codex-jev-partner-ai-gateway -w
security find-generic-password -a "$(id -un)" -s codex-jev-partner-ai-gateway -w >/dev/null
```

The first command prompts for the secret without placing it in shell history. Restart Codex after changing the launch environment or Keychain item. Never paste the value into an issue or evaluation payload.

## GitHub Access

The repository is public and does not require collaborator access. Confirm your network and local Git installation can read `https://github.com/leokessel-lgtm/jev-codex-partner`.

## Installation Failures

Verify you are using the exact installation commands documented in the [README.md](../README.md). Ensure the `--ref main` flag is included.

Repository access and JEV gateway authentication are separate checks. Cloning is public, but evaluations still require your own gateway credential.

## Evaluation failures

- `gateway_not_configured`: configure one of the authentication methods above.
- `invalid_input`: reduce the payload, remove credential-shaped content and check the typed question shape.
- `gateway_authentication_failed`: verify that the configured gateway credential is current and belongs to the intended account.
- `gateway_zdr_unavailable`: the gateway explicitly reported that the account plan cannot satisfy the requested zero-data-retention route. Do not remove the private or sensitive classification to bypass this control. Use an eligible account or keep the data local.
- `gateway_forbidden`: the gateway returned HTTP 403 without the recognised ZDR restriction. Inspect account access and policy without assuming the cause.
- `gateway_request_rejected`: inspect the sanitised provider detail and typed payload shape.
- `invalid_gateway_response`: retain the receipt fields and report the mismatch; do not reinterpret unvalidated provider output manually.
- timeout or retry exhaustion: retry only when the request and authority are unchanged and the external cost is acceptable.

On success, `requestId` is the JEV generation identifier. `gatewayRequestId`, when present, is the separate HTTP request identifier captured from the gateway response. `pluginVersion` identifies the adapter contract that normalised the result. Include these non-secret fields in a bug report, but never include the credential or private payload.

## Link Checking Failures

If the CI fails on relative links, ensure all Markdown links point to valid local targets without escaping the repository root. Query strings and fragments are stripped during validation.
