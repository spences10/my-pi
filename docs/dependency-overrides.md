---
title: Dependency overrides
tags: [dependencies, pnpm, vite-plus]
aliases: [Dependency resolution]
---

# Dependency overrides

Dependency resolution is configured in
[pnpm-workspace.yaml](../pnpm-workspace.yaml), with the resolved tree
in [pnpm-lock.yaml](../pnpm-lock.yaml). Check those files when
updating dependencies; a remembered security pin may no longer be
present.

## Current overrides

| Selector   | Value      | Purpose                                                 |
| ---------- | ---------- | ------------------------------------------------------- |
| `vite@*`   | `catalog:` | Resolve Vite through the workspace's aliased Vite+ core |
| `vitest@*` | `catalog:` | Keep Vitest aligned with the workspace toolchain        |

These are toolchain alignment overrides, not the old set of transitive
security pins. Earlier versions of this page listed `brace-expansion`,
`postcss`, `protobufjs`, `ws`, `js-yaml`, and `cookie` overrides;
those selectors are absent from the current configuration. Their old
advisory ranges are not a current audit.

## Catalogs and release age

The default catalog holds shared versions, including the Pi packages
and Vite+ toolchain. The named `typescript6` catalog keeps the
compiler API needed by Svelte tooling while `@typescript/native`
supplies its TypeScript 7 checker; see the
[website README](../apps/web/README.md).

The workspace sets `minimumReleaseAge: 2880` minutes, and
[Renovate](../renovate.json) uses a two-day minimum. Renovate groups
related toolchain updates and disables automatic override updates.
Inspect its actual rules rather than treating every override as the
same kind of pin.

## Updating resolution

A useful update loop is:

1. Edit the intended catalog entry, package dependency, or override.
2. Run `pnpm install` to update the lockfile.
3. Inspect the diff and use `pnpm why <package>` to check the path
   being changed.
4. Run `pnpm audit --audit-level low` when evaluating security
   resolution.
5. Run the checks appropriate to the affected packages; use
   [root validation](./development.md#choose-checks-for-the-change)
   for shared toolchain changes.

If testing whether an override is still needed, remove one selector at
a time and compare resolution and validation. An audit checks known
advisories; it does not prove runtime compatibility. Document any new
pin's actual reason and removal condition rather than keeping stale
advisory tables.
