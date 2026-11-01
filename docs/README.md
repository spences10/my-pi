---
title: Documentation
tags: [documentation]
aliases: [Docs index]
---

# Documentation

[my-pi](../README.md) is upstream Pi with a switchable collection of
extensions. You can use the launcher or install individual packages
into Pi.

## Start here

- [Getting started](./getting-started.md): run my-pi, select
  extensions, and find configuration.
- [Package map](./package-map.md): choose packages and find their
  READMEs.
- [Architecture](./architecture.md): how the launcher, upstream Pi,
  and shared packages fit together.
- [Development](./development.md): build locally, test one package,
  and choose validation commands.

## Maintaining the project

- [Writing and searching docs](./documentation.md): wiki0 CLI
  workflow, sources, and public-safe use of session history.
- [Package README maintenance](./package-readmes.md): generated
  regions and npm-compatible links.
- [Dependency overrides](./dependency-overrides.md): current
  overrides, catalogs, and release-age configuration.
- [Package releases](./releases.md): Changesets, publishing, and tags.
- [Context benchmarks](./pi-context-benchmark.md): measured workloads,
  limitations, and reproduction.
- [Team Mode benchmarks](./pi-team-mode-benchmark.md): delivery noise,
  bounded batches, and quiet status updates.
- [Website development](../apps/web/README.md): local preview and
  Cloudflare deployment.

These guides describe the current implementation and useful workflows;
they are not a freeze on architecture or package boundaries. Package
READMEs carry package-specific behaviour and configuration. For Pi's
own features, use the [upstream documentation](https://pi.dev).

## Search with wiki0

From the repository root:

```bash
pnpx @wiki0/cli index
pnpx @wiki0/cli search "extension settings"
pnpx @wiki0/cli show docs/getting-started.md
pnpx @wiki0/cli ui
```

Search results contain citations you can pass to `show`. The browser
UI is optional; the Markdown remains readable on GitHub. See
[the docs workflow](./documentation.md) for indexing and checks.
