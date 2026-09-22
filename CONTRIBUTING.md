# Contributing

This repository is public and intentionally unlicensed. Public visibility does not grant reuse rights. Discuss a proposed contribution with the repository owner before preparing it; accepted changes still require maintainer review.

## Workflow

1. Create a feature branch.
2. Keep package, server and plugin-manifest versions aligned.
3. Ensure you have run local checks before pushing.
4. Submit a pull request for review.

## Testing

Run `npm ci` and `npm run check` within `plugins/jev-codex-partner`, then run `node scripts/check-relative-links.mjs` from the repository root.
Never run `benchmark:live` in automated environments.

Do not commit environment files, credentials, private evaluation payloads, installed dependencies or generated local state.

## Commit message guidelines

Provide clear and concise commit messages. Lead with the outcome.
