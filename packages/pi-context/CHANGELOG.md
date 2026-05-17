# @spences10/pi-context

## 0.0.18

### Patch Changes

- ffea37e: Standardize shared dependency versions through pnpm catalog
  and align package dev dependencies for CI.
- Updated dependencies [ffea37e]
  - @spences10/pi-tui-modal@0.0.16
  - @spences10/pi-redact@0.0.9

## 0.0.17

### Patch Changes

- Updated dependencies [600dbac]
  - @spences10/pi-tui-modal@0.0.15

## 0.0.16

### Patch Changes

- e58b031: Add missing per-file smoke tests across packages and enable
  full test runs for weakly covered modules
- Updated dependencies [2305de8]
- Updated dependencies [e58b031]
  - @spences10/pi-tui-modal@0.0.14

## 0.0.15

### Patch Changes

- e14275b: Improve pi-context search fallback behavior and add
  deterministic before-after eval harness for retrieval scenarios
- bea8707: Add package-specific homepage links so Pi gallery pages
  point to each package README.
- 7db4cfc: Improve context retrieval guidance, cross-session dedupe,
  source-id scoping, and expanded eval coverage.
- 3e91b90: Add shared package gallery preview image to all Pi package
  manifests.
- Updated dependencies [bea8707]
- Updated dependencies [3e91b90]
  - @spences10/pi-redact@0.0.8

## 0.0.14

### Patch Changes

- 8944bf8: Move Pi core runtime packages to peer dependencies for
  safer external extension installs.
- Updated dependencies [8944bf8]
  - @spences10/pi-tui-modal@0.0.13
  - @spences10/pi-redact@0.0.7

## 0.0.13

### Patch Changes

- Updated dependencies [c771d16]
  - @spences10/pi-tui-modal@0.0.12

## 0.0.12

### Patch Changes

- Updated dependencies [7fcd066]
  - @spences10/pi-tui-modal@0.0.11

## 0.0.11

### Patch Changes

- 0f63525: Split oversized context, modal, and team command modules
  into smaller focused implementation files.
- Updated dependencies [0f63525]
  - @spences10/pi-tui-modal@0.0.10

## 0.0.10

### Patch Changes

- dacf04d: Simplify skills TUI navigation, split importable skill
  actions, and clarify profile policy/rule wording.
- 44136fe: Migrate Pi core dependencies from Mario Zechner scope to
  Earendil Works package scope.
- Updated dependencies [dacf04d]
- Updated dependencies [44136fe]
  - @spences10/pi-tui-modal@0.0.9
  - @spences10/pi-redact@0.0.6

## 0.0.9

### Patch Changes

- Updated dependencies [fd8a6ae]
  - @spences10/pi-tui-modal@0.0.8

## 0.0.8

### Patch Changes

- 1ef0bb8: Fix skills reload using fresh profile config so enabled
  cl-\* skills appear after TUI reload.

## 0.0.7

### Patch Changes

- 9bbacf1: Improve pi-context chunk retrieval UX with first chunk
  receipts, aliases, and helpful miss messages.
- Updated dependencies [9bbacf1]
  - @spences10/pi-tui-modal@0.0.7
  - @spences10/pi-redact@0.0.5

## 0.0.6

### Patch Changes

- 92b9ff0: Add configurable context sidecar retention, storage caps,
  capture thresholds, and nested settings menus.

## 0.0.5

### Patch Changes

- Updated dependencies [7b27f9e]
  - @spences10/pi-tui-modal@0.0.6

## 0.0.4

### Patch Changes

- 1745de7: Refactor pi-context store into focused schema, policy,
  text, and type modules without behavior changes.
- aa8cfb7: Improve extension UX with context modal, MCP profile
  picker, clearer redaction naming, and team cleanup.
- f4203a0: Document context sidecar coverage policy and prevent
  recursive indexing of context and MCP receipts.
- 63438fd: Extract pi-context SQLite schema into packaged SQL file
  with migration versioning and build/test coverage.
- c7d0025: Add context sidecar retention policy, lifecycle cleanup,
  purge filters, and stats reporting.
- fd9a2b2: Add scoped context source listing tool and command with
  filters, pagination, and metadata previews.
- 03e02a8: Deduplicate same-scope context sources and improve purge
  details with project and session filter support.
- 35d85b9: Improve context receipts, scoped stats, previews, and
  documentation for clearer sidecar retrieval UX.
- 2fa5ae5: Scope context sidecar storage and retrieval to current
  project/session with explicit global lookup.

## 0.0.3

### Patch Changes

- ca3d5e5: Harden redaction, document eval workflow, align Node
  support, and clarify SQLite warning policy across packages.
- d8c5c5b: Replace hand-coded workspace dependency builds with pnpm
  graph-backed self tasks and script consistency tests.
- Updated dependencies [ca3d5e5]
- Updated dependencies [f3c5600]
- Updated dependencies [d8c5c5b]
  - @spences10/pi-redact@0.0.4

## 0.0.2

### Patch Changes

- 2552f1f: Add comprehensive context sidecar eval tests, improve line
  chunking
