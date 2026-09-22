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

- `missing_api_key`: configure one of the authentication methods above.
- `validation_error`: reduce the payload, remove credential-shaped content and check the typed question shape.
- `provider_error`: inspect the sanitised status and request identifier; credentials are intentionally removed from surfaced errors.
- timeout or retry exhaustion: retry only when the request and authority are unchanged and the external cost is acceptable.

## Link Checking Failures

If the CI fails on relative links, ensure all Markdown links point to valid local targets without escaping the repository root. Query strings and fragments are stripped during validation.
