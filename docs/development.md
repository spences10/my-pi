---
title: Development
tags: [development, validation]
aliases: [Local development]
---

# Development

## Build and run a checkout

The [root manifest](../package.json) declares Node.js `>=24.15.0` and
the pnpm version used by this repository.

```bash
pnpm install
pnpm run build
node packages/my-pi/dist/index.js --help
pnpm start
```

`pnpm start` runs that same built launcher. Rebuild after source
changes; starting the published `pnpx my-pi@latest` will not test your
checkout.

The [package map](./package-map.md) helps locate an implementation.
Read that package's README for setup and any special build steps.

## Work on one package

For example:

```bash
pnpm --filter @spences10/pi-lsp run check
pnpm --filter @spences10/pi-lsp run test
pnpm --filter @spences10/pi-lsp run build
```

The public package scripts build transitive workspace dependencies
before running local tools. Their `check:self`, `test:self`, and
`build:self` counterparts skip dependency builds and are useful when
those dependencies are already built. See the
[LSP manifest](../packages/pi-lsp/package.json) for an example.

For an extension package, a one-run local load is useful after
building:

```bash
pi -e ./packages/pi-lsp
```

That runs upstream Pi with the local package, whereas the local my-pi
launcher loads its whole enabled collection. If investigating
interactions, choose the entrypoint that matches the reproduction.

## Choose checks for the change

The [root scripts](../package.json) provide:

| Command                     | Coverage                                                                             |
| --------------------------- | ------------------------------------------------------------------------------------ |
| `pnpm run docs:check`       | Generated README regions and local Markdown links                                    |
| `pnpm run check`            | Docs checks, package builds, Vite+ checks, import boundaries, and package typechecks |
| `pnpm run test`             | Package builds and package test suites                                               |
| `pnpm run check:boundaries` | Cross-package import checks                                                          |
| `pnpm run eval:suite`       | Smoke eval runner                                                                    |
| `pnpm run coverage`         | Package builds and coverage-enabled tests                                            |

For docs edits, also run `pnpx @wiki0/cli check`. A focused package
change can start with that package's checks; shared changes benefit
from root validation. Reuse successful checks when their inputs have
not changed rather than rerunning them for each review step. Agent
command selection is described in the
[validation skill](../.agents/skills/pi-validation-flow/SKILL.md).

The [CI workflow](../.github/workflows/ci.yml) runs root checks,
tests, builds, smoke evals, and launcher help. The website has
[its own workflow](../.github/workflows/web.yml) and
[development instructions](../apps/web/README.md).

## Common development loops

- **Launcher wiring:** inspect
  [the registry](../packages/my-pi/src/extensions.ts), its manifest
  dependencies, and the launcher tests.
- **Dashboard:** follow the
  [observability README](../packages/pi-observability/README.md) and
  [local development skill](../.agents/skills/pi-observability-local-dev/SKILL.md)
  so the running server actually serves the rebuilt assets.
- **Docs:** use [wiki0](./documentation.md) to find the existing
  section, edit it, and check links.
- **Dependency updates:** inspect
  [catalogs and overrides](./dependency-overrides.md) before changing
  resolution.
- **Release preparation:** follow [Package releases](./releases.md);
  building a checkout does not publish it.

Tests generally live beside source as `*.test.ts`. Public package
entrypoints are the supported way to share helpers across packages;
the executable check is
[tools/check-boundaries.ts](../tools/check-boundaries.ts).

## Reporting a problem

Include the package or extension key, command used, expected result,
actual result, and a small reproduction. Say whether you ran the
published launcher, local built launcher, or standalone Pi package.

Review logs and exports before attaching them. Session prompts, file
paths, tool output, and authenticated dashboard links can reveal more
than the error itself.
