---
name: pi-extension-development
# prettier-ignore
description: Use when creating or modifying Pi extensions, built-in extension wiring, prompt shims, package scaffolds, package READMEs, or packages/pi-* implementation in this monorepo.
compatibility:
  Requires the Pi coding-agent monorepo and extension API.
---

# Pi Extension Development

Use this workflow for `packages/pi-*` implementation work in this
repo.

## Workflow

1. Check upstream Pi first (`pi-primitive-check`). Add a package only
   for behaviour Pi does not provide.
2. New extensions go in a `packages/pi-*` workspace package. Add it to
   my-pi with an entry in `packages/my-pi/src/extensions.ts` and a
   `workspace:*` dependency in `packages/my-pi/package.json`.
3. Keep extension entrypoints small: export a default extension
   function and pure helper functions for testable trigger logic.
4. Put user-facing injected prompt text in one obvious template block;
   gate injection by selected tools/options when possible.
5. Update package README and Changeset when behavior changes.
6. Validate with the package script first, then root checks if root
   files changed.

## Project conventions

- Prefer `@spences10/pi-*` workspace packages with `workspace:*`
  links.
- Tests live beside source as `*.test.ts` and should cover
  trigger/gating helpers.
- Avoid importing another package's `src/*` or `dist/*`; use public
  package entrypoints.
- Use `references/checklist.md` for the exact file checklist when
  adding a package.
