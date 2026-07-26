---
name: pi-release-workflow
# prettier-ignore
description: Use when preparing or validating Pi monorepo releases, including Changesets, pnpm lockfile updates, package previews, release-age policy, and installability checks.
compatibility:
  Requires this Pi coding-agent monorepo release workflow.
---

# Pi Release Workflow

Use this when preparing, validating, or debugging package releases
from this repo.

## Workflow

1. Check current package changes and Changesets before editing
   versions.
2. Classify each affected package by its public behavior; do not infer
   the release level from the commit label alone.
3. Respect pnpm `minimumReleaseAge`; do not blindly bypass it for
   fresh registry packages.
4. For catalog/version updates, edit `pnpm-workspace.yaml` or package
   manifests intentionally, then run `pnpm install` to refresh the
   lockfile.
5. Regenerate release artifacts when required, especially
   startup/package preview assets.
6. Validate locally, then test published-package installability with
   the sandbox skill when applicable.

## Version classification

- **Patch:** bug fixes, documentation, dependency maintenance, and
  internal refactors that preserve public behavior.
- **Minor:** new commands, tools, configuration, APIs, or other
  backward-compatible user-visible capabilities.
- **Breaking:** use major releases for stable `1.x` packages. While a
  package intentionally remains pre-1.0, use a minor release and call
  out the breaking behavior explicitly.
- Treat `0.0.x` as genuinely experimental. Move a package to `0.1.0`
  when it gains a meaningful public feature or is ready for a more
  stable pre-1.0 contract; do not keep shipping features as patches
  merely because the package started at `0.0.x`.
- Classify packages independently in batch releases. A root `my-pi`
  bump does not require every affected workspace package to use the
  same release level.
- Do not rewrite published versions to correct historical release
  classification; apply the policy to the next release.

## Commands and checks

- `pnpm changeset status` for pending release intent.
- `pnpm install --frozen-lockfile` to verify committed lockfile state.
- `pnpm run preview:generate` when preview image output should change.
- `pnpm run check` before release PRs or publishing.
- Use `pi-package-sandbox-test` for normal-user install/load
  validation of published Pi packages.

## Pitfalls from recent sessions

- `pnpm update -r --latest --catalog` is not the safe catalog workflow
  here.
- Local workspace packages do not need `minimumReleaseAgeExclude`;
  that applies to registry packages.
- If a validator is missing, report it and use `pnpx` only when
  appropriate.
