---
name: pi-validation-flow
# prettier-ignore
description: Use when validating changes in this extension monorepo after editing TypeScript, Svelte, package manifests, tests, repo tooling, skills, or docs.
compatibility: Requires the my-pi monorepo validation scripts.
---

# Pi Validation Flow

Validate after the final relevant edit. Reuse passed checks for
completion, review, commit, and push if file contents, dependencies,
configuration, and relevant environment are unchanged. Verify inputs,
not just file names. Rerun only affected or previously missing checks.

## Workflow

1. Inspect `git status --short` and `git diff --name-only HEAD`.
2. Run the narrowest package validation for changed packages.
3. Use LSP diagnostics for changed TypeScript/Svelte source files when
   available. The switchable LSP extension is not required for package
   checks.
4. Use root validation for shared files, root scripts, package
   manifests, or lockfile changes; do not repeat package checks it
   already covers.
5. Report failures honestly: separate new failures, pre-existing
   failures, skipped checks, and unavailable tools.

## Command selection

- Single package: `pnpm --filter @spences10/<pkg> run check` and
  `test`; these build transitive workspace dependencies first. Use
  `check:self` and `test:self` only when those dependency builds are
  available and their inputs are unchanged.
- Root/shared code, manifest, or lockfile changes: `pnpm run check`.
  This does not run tests; also run affected package tests, or
  `pnpm run test` when the impact spans packages. Documentation and
  skill-only changes use their dedicated checks below.
- Boundary-sensitive changes: `pnpm run check:boundaries` unless
  already covered by root validation.
- Svelte files: run Svelte-specific validation; also use LSP
  diagnostics when available.
- Docs: run `pnpx @wiki0/cli check` and `pnpm run docs:check`.
- Skills: after the final edit, validate each affected skill root:
  `.agents`, `packages/pi-harness/skills`, or
  `packages/pi-tool-guidance/skills`, using
  `pnpx check-skills validate <root> --recursive --json`.

## Reporting format

Keep the final report short:

- Changed: files/packages touched.
- Validation: commands run or reused and results.
- Risks: only unresolved failures or skipped checks.
