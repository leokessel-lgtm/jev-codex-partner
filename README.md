# JEV Codex Partner Marketplace

Public, repo-local Codex marketplace for governed TypeSafe JEV evaluations. It adds one prompted MCP tool for bounded Boolean, Choice and Score judgements.

The repository is intentionally unlicensed. Public visibility permits inspection and cloning but does not grant a general right to copy, redistribute, publish or create derivative works from the code.

## Prerequisites

- Git access to `github.com`.
- Codex with plugin marketplace support.
- Node.js 20 or later for local development.

## Installation

Run the following commands to install the marketplace and plugin:

```bash
codex plugin marketplace add leokessel-lgtm/jev-codex-partner --ref main
codex plugin add jev-codex-partner@leo-jev-codex-partner
```

## Authentication

Use your own Vercel AI Gateway credential. Set `AI_GATEWAY_API_KEY` in the environment that launches Codex, or use the macOS Keychain fallback described in [troubleshooting](docs/troubleshooting.md). Credentials must never be committed or placed in evaluation payloads.

## Features

The plugin accepts a purpose, minimal state and one or more typed questions:

- **Boolean:** a bounded true-or-false assessment with optional criteria.
- **Choice:** selection among a finite set of labelled alternatives.
- **Score:** a numeric position against two to ten ordered rubric anchors, including fractional positions when returned by JEV.

## Suitability and Limitations

Use JEV for classification, routing and rubric assessment where typed probabilities improve a bounded decision. Do not use it for generation, open-ended research, arithmetic, dates, planning, deterministic checks or autonomous consequential decisions.

- Every evaluation sends the approved payload to TypeSafe JEV through Vercel AI Gateway and may be billable.
- Private or sensitive payloads require action-time approval for the exact fields, destination and purpose.
- The plugin requests zero-data-retention routing for private and sensitive payloads, but availability depends on current provider and plan support and is not a compliance guarantee.
- Results are advisory only. They do not approve transactions, deployments, publications or other consequential actions.

Successful evaluations report the plugin version, the JEV generation identifier and, when supplied by the gateway, a separate HTTP request identifier. These receipt fields support troubleshooting and provenance; they do not establish that the result is correct.

## Benchmarks

From `plugins/jev-codex-partner`:

```bash
npm run benchmark:preview
npm run benchmark:live -- --confirm-synthetic
```

Preview is local and makes no evaluation request. Live mode is external and potentially billable, accepts only the bundled synthetic fixtures and requires explicit confirmation. It never runs in CI.

## Documentation

- [Architecture](docs/architecture.md)
- [Governance and Privacy](docs/governance-and-privacy.md)
- [Troubleshooting](docs/troubleshooting.md)
- [Plugin Details](plugins/jev-codex-partner/README.md)

## Development

```bash
cd plugins/jev-codex-partner
npm ci
npm run check
```
