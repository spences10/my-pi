---
title: Architecture
tags: [architecture, launcher, extensions]
aliases: [Launcher architecture]
---

# Architecture

## Upstream Pi plus extensions

The launcher calls upstream Pi's `main()` with extra extension
factories. It does not run a separate agent loop.
[The entrypoint](../packages/my-pi/src/index.ts) passes through
command arguments and adds the enabled theme directory and bundled
factories.

MCP, codemode, tool search, skills, sessions, and general package
configuration belong to the upstream Pi runtime. The
[launcher README](../packages/my-pi/README.md) describes this split;
the pinned upstream dependencies are in the
[workspace catalog](../pnpm-workspace.yaml).

This explains why older session notes about custom MCP managers or a
separate SDK startup path may no longer describe the checkout. Use the
current entrypoint when investigating startup behaviour.

## Startup and extension selection

The current startup flow is:

1. `packages/my-pi/src/index.ts` assembles named extension factories.
2. Each bundled factory checks its saved switch when Pi loads it.
3. Enabled factories load their package implementation.
4. Upstream Pi owns the resulting session and extension lifecycle.

[extensions.ts](../packages/my-pi/src/extensions.ts) is the registry
of keys, labels, loaders, and bundled skill resources.
[settings.ts](../packages/my-pi/src/settings.ts) reads the switches;
[manager.ts](../packages/my-pi/src/manager.ts) implements
`/extensions`. Themes are supplied at startup because Pi selects them
before extension factories run.

For adding an extension to the current launcher, the relevant pieces
are its registry entry and a workspace dependency in
[the launcher manifest](../packages/my-pi/package.json). A new feature
may fit an existing package instead.

## Independent packages and shared helpers

Most packages expose a Pi extension and can be installed without
my-pi. Support packages share capabilities such as settings, SQLite,
child-process environments, resource-specific trust, and TUI modals.
The [package map](./package-map.md) distinguishes these roles.

The dependency graph uses `workspace:*` links. Package scripts build
transitive workspace dependencies before local checks; root scripts
build the collection. See [Development](./development.md).

## Related features with different jobs

### Context, recall, telemetry, and observability

These features answer different questions:

| Feature         | Question                                                | Reference                                                  |
| --------------- | ------------------------------------------------------- | ---------------------------------------------------------- |
| Context sidecar | How can I recover oversized tool output from this work? | [pi-context](../packages/pi-context/README.md)             |
| Recall          | What happened in earlier coding sessions?               | [pi-recall](../packages/pi-recall/README.md)               |
| Telemetry       | How did runs and tools behave over time?                | [pi-telemetry](../packages/pi-telemetry/README.md)         |
| Observability   | What is happening in live traces and the dashboard?     | [pi-observability](../packages/pi-observability/README.md) |

Native codemode can reduce tool results before they reach the model.
The sidecar leaves intermediate codemode results available to scripts
and captures oversized final output as a searchable fallback. It is an
ephemeral cache, not durable session memory. The
[context benchmarks](./pi-context-benchmark.md#native-codemode-benchmark)
measure that distinction, including native-only comparisons.

Telemetry and dashboard rollups follow Pi's canonical session usage
accounting rather than defining a competing token total. Their READMEs
explain their different persistence and event views.

### Team Mode and task harnesses

[Team Mode](../packages/pi-team-mode/README.md) coordinates
independently opened sessions through a local bus, mailboxes, groups,
and artifacts. It does not spawn or supervise workers.

[pi-harness](../packages/pi-harness/README.md) offers optional task
contracts and validation scaffolding. Installing it does not make a
harness a prerequisite for ordinary project work.

## Settings and trust

[pi-settings](../packages/pi-settings/README.md) keeps global my-pi
extension state separate from upstream Pi's resource configuration.
[pi-project-trust](../packages/pi-project-trust/README.md) supplies
resource-specific decisions for things such as project-local
executables; upstream Pi owns its standard whole-project trust.

## Finding code

- Launcher and extension registry: `packages/my-pi/src/`.
- Package entrypoints and tests: `packages/pi-*/src/`.
- Documentation generators and dependency checks: `tools/`.
- Smoke eval definitions and runners: `evals/` and `scripts/`.
- Public landing page: `apps/web/`, documented in its
  [README](../apps/web/README.md).

The [root scripts](../package.json) and
[CI workflow](../.github/workflows/ci.yml) show how those pieces are
validated together.
