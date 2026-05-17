# @spences10/pi-redact

## 0.0.9

### Patch Changes

- ffea37e: Standardize shared dependency versions through pnpm catalog
  and align package dev dependencies for CI.

## 0.0.8

### Patch Changes

- bea8707: Add package-specific homepage links so Pi gallery pages
  point to each package README.
- 3e91b90: Add shared package gallery preview image to all Pi package
  manifests.

## 0.0.7

### Patch Changes

- 8944bf8: Move Pi core runtime packages to peer dependencies for
  safer external extension installs.

## 0.0.6

### Patch Changes

- dacf04d: Simplify skills TUI navigation, split importable skill
  actions, and clarify profile policy/rule wording.
- 44136fe: Migrate Pi core dependencies from Mario Zechner scope to
  Earendil Works package scope.

## 0.0.5

### Patch Changes

- 9bbacf1: Improve pi-context chunk retrieval UX with first chunk
  receipts, aliases, and helpful miss messages.

## 0.0.4

### Patch Changes

- ca3d5e5: Harden redaction, document eval workflow, align Node
  support, and clarify SQLite warning policy across packages.
- f3c5600: Fix redaction false positives for source variables and
  clear MCP request timers after completion.
- d8c5c5b: Replace hand-coded workspace dependency builds with pnpm
  graph-backed self tasks and script consistency tests.

## 0.0.3

### Patch Changes

- 627f483: Standardize package READMEs with npm badges, Vite+/Vitest
  messaging, installation, and development docs.

## 0.0.2

### Patch Changes

- 5c37302: Align workspace Pi dependencies and group Renovate updates
  to prevent duplicate extension API types.

## 0.0.1

### Patch Changes

- ada9a75: Split redaction and telemetry into installable Pi workspace
  packages with dedicated documentation and extension manifests.
- a6ff57b: Extract MCP, LSP, and skills into public installable Pi
  workspace packages.
- 148aa42: Add recall and nopeek prompt reminder packages with
  background recall sync on session lifecycle.
