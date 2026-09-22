# JEV Codex Partner Plugin

This package exposes one prompted `evaluate` MCP tool and a concise skill for deciding when bounded Boolean, Choice or Score judgement is useful. Requests go to TypeSafe JEV through Vercel AI Gateway and may be billable.

## Local Source

This private package is distributed through the repository marketplace manifest at [`../../.agents/plugins/marketplace.json`](../../.agents/plugins/marketplace.json). It is marked private and must not be published to npm.

## Development

Install and run local checks with Node.js 20 or later:

```bash
npm ci
npm run check
```

Preview the bundled synthetic benchmarks with `npm run benchmark:preview`. `npm run benchmark:live -- --confirm-synthetic` makes external requests and must be deliberately confirmed; it never belongs in CI.

## Usage

See the [root README](../../README.md) for installation. Selection, transfer and interpretation boundaries remain canonical in [`skills/jev-codex-partner/SKILL.md`](skills/jev-codex-partner/SKILL.md) and its linked references.
