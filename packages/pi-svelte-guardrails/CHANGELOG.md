# @spences10/pi-svelte-guardrails

## 0.0.7

### Patch Changes

- ffea37e: Standardize shared dependency versions through pnpm catalog
  and align package dev dependencies for CI.

## 0.0.6

### Patch Changes

- e58b031: Add missing per-file smoke tests across packages and enable
  full test runs for weakly covered modules

## 0.0.5

### Patch Changes

- bea8707: Add package-specific homepage links so Pi gallery pages
  point to each package README.
- 3e91b90: Add shared package gallery preview image to all Pi package
  manifests.

## 0.0.4

### Patch Changes

- 8944bf8: Move Pi core runtime packages to peer dependencies for
  safer external extension installs.

## 0.0.3

### Patch Changes

- cccaa90: Make Svelte guardrails configurable with effect disabling,
  allowed path globs, defaults, tests, and documentation.
- ec9baf4: Add Svelte guardrail rule modes for blocking, warning,
  disabling, plus project-local config overrides.
- 5d8de6a: Document Svelte guardrails status, disabling options,
  configuration, built-in behavior, and blocked-write semantics.

## 0.0.2

### Patch Changes

- cf3e775: Enable Svelte guardrails by default and clarify blocked
  writes must be retried without $effect.
