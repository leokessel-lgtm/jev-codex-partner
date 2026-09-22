# Architecture and data flow

This repository is a Codex marketplace containing one Node.js MCP plugin. The marketplace manifest points to `plugins/jev-codex-partner`; the plugin manifest exposes its skill and `.mcp.json` server configuration.

## Overview

```text
Codex
  -> prompted evaluate tool
  -> local schema, size and credential checks
  -> HTTPS request through Vercel AI Gateway
  -> TypeSafe JEV
  -> local response-size and typed-output validation
  -> advisory MCP result
```

The tool accepts only the fields defined in [`src/contracts.mjs`](../plugins/jev-codex-partner/src/contracts.mjs). The provider receives the submitted purpose, state and questions plus fixed routing options. It does not receive arbitrary repository contents unless a user includes that material in the approved state.

## Evaluation Mechanisms

- **Boolean:** true or false, with optional definitions for both outcomes.
- **Choice:** one label from two or more supplied alternatives.
- **Score:** one integer position on a supplied ordered rubric.

## Network Architecture

The endpoint and model are fixed in the local contracts. The gateway request disallows prompt training. Private and sensitive classifications additionally request zero-data-retention routing. Those requested options do not prove provider availability or establish compliance.

The client enforces request and response byte limits, rejects credential-shaped input, does not follow redirects, bounds retries and timeouts, and validates the returned typed probabilities before presenting them to Codex.

## Canonical sources

- [`src/contracts.mjs`](../plugins/jev-codex-partner/src/contracts.mjs): endpoint, model, request shape and limits.
- [`skills/jev-codex-partner/SKILL.md`](../plugins/jev-codex-partner/skills/jev-codex-partner/SKILL.md): selection and interpretation rules.
- [`selection-and-governance.md`](../plugins/jev-codex-partner/skills/jev-codex-partner/references/selection-and-governance.md): transfer and authority controls.
- Tests under [`test/`](../plugins/jev-codex-partner/test/): current executable evidence.
