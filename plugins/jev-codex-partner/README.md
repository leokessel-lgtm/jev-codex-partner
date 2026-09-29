# JEV Codex Partner Plugin

This package exposes one prompted `evaluate` MCP tool and two focused skills. `jev-codex-partner` covers bounded Boolean, Choice or Score judgement; `jev-evidence-evaluation` covers Boolean-only claim support, citation support and semantic equivalence with fail-closed provenance controls. Requests go to TypeSafe JEV through Vercel AI Gateway and may be billable.

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
