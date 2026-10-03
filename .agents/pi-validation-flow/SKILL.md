---
name: pi-validation-flow
# prettier-ignore
description: Use when validating Pi monorepo changes after editing TypeScript, Svelte, package manifests, built-in registry, tests, repo tooling, skills, or docs.
compatibility:
  Requires the Pi coding-agent monorepo validation scripts.
---

# Pi Validation Flow

Validate after the final relevant edit. Reuse passed checks for
completion, review, commit, and push if file contents, dependencies,
configuration, and relevant environment are unchanged. Verify inputs,
not just file names. Rerun only affected or previously missing checks.

## Workflow

1. Inspect `git status --short` and `git diff --name-only HEAD`.
2. Run the narrowest package validation for changed packages.
3. Run LSP diagnostics for changed TypeScript/Svelte source files.
4. Use root validation for shared files, root scripts, package
   manifests, lockfile, or built-in registry changes; do not repeat
   package checks it already covers.
5. Report failures honestly: separate new failures, pre-existing
   failures, skipped checks, and unavailable tools.

## Command selection

- Single package: `pnpm --filter @spences10/<pkg> run check:self` and
  `test:self`.
- Root/shared changes: `pnpm run check`.
- Boundary-sensitive changes: `pnpm run check:boundaries` unless
  already covered by root validation.
- Svelte files: use Svelte-specific validation and LSP diagnostics.
- Skills: run `pnpx check-skills validate .agents --recursive --json`
  once after the final skill edit.

## Reporting format

Keep the final report short:

- Changed: files/packages touched.
- Validation: commands run or reused and results.
- Risks: only unresolved failures or skipped checks.
