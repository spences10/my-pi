# @spences10/pi-lsp

## 0.0.25

### Patch Changes

- ffea37e: Standardize shared dependency versions through pnpm catalog
  and align package dev dependencies for CI.
- Updated dependencies [ffea37e]
  - @spences10/pi-project-trust@0.0.7
  - @spences10/pi-child-env@0.1.5
  - @spences10/pi-tui-modal@0.0.16

## 0.0.24

### Patch Changes

- Updated dependencies [600dbac]
  - @spences10/pi-tui-modal@0.0.15

## 0.0.23

### Patch Changes

- e58b031: Add missing per-file smoke tests across packages and enable
  full test runs for weakly covered modules
- Updated dependencies [2305de8]
- Updated dependencies [e58b031]
  - @spences10/pi-tui-modal@0.0.14

## 0.0.22

### Patch Changes

- bea8707: Add package-specific homepage links so Pi gallery pages
  point to each package README.
- 3e91b90: Add shared package gallery preview image to all Pi package
  manifests.

## 0.0.21

### Patch Changes

- 8944bf8: Move Pi core runtime packages to peer dependencies for
  safer external extension installs.
- Updated dependencies [8944bf8]
  - @spences10/pi-tui-modal@0.0.13

## 0.0.20

### Patch Changes

- Updated dependencies [c771d16]
  - @spences10/pi-tui-modal@0.0.12

## 0.0.19

### Patch Changes

- Updated dependencies [7fcd066]
  - @spences10/pi-tui-modal@0.0.11

## 0.0.18

### Patch Changes

- Updated dependencies [0f63525]
  - @spences10/pi-tui-modal@0.0.10

## 0.0.17

### Patch Changes

- dacf04d: Simplify skills TUI navigation, split importable skill
  actions, and clarify profile policy/rule wording.
- 44136fe: Migrate Pi core dependencies from Mario Zechner scope to
  Earendil Works package scope.
- Updated dependencies [dacf04d]
- Updated dependencies [44136fe]
  - @spences10/pi-project-trust@0.0.6
  - @spences10/pi-child-env@0.1.4
  - @spences10/pi-tui-modal@0.0.9

## 0.0.16

### Patch Changes

- Updated dependencies [fd8a6ae]
  - @spences10/pi-tui-modal@0.0.8

## 0.0.15

### Patch Changes

- 1ef0bb8: Fix skills reload using fresh profile config so enabled
  cl-\* skills appear after TUI reload.

## 0.0.14

### Patch Changes

- 9bbacf1: Improve pi-context chunk retrieval UX with first chunk
  receipts, aliases, and helpful miss messages.
- Updated dependencies [9bbacf1]
  - @spences10/pi-tui-modal@0.0.7

## 0.0.13

### Patch Changes

- Updated dependencies [7b27f9e]
  - @spences10/pi-tui-modal@0.0.6

## 0.0.12

### Patch Changes

- 8a6c2c7: Refactor pi-lsp into focused modules for prompts, tools,
  commands, server management, and matching test files.

## 0.0.11

### Patch Changes

- ca3d5e5: Harden redaction, document eval workflow, align Node
  support, and clarify SQLite warning policy across packages.
- 0495264: Split LSP, telemetry, MCP, and team store god files into
  focused modules with colocated tests.
- d8c5c5b: Replace hand-coded workspace dependency builds with pnpm
  graph-backed self tasks and script consistency tests.
- Updated dependencies [ca3d5e5]
- Updated dependencies [d8c5c5b]
  - @spences10/pi-project-trust@0.0.5
  - @spences10/pi-child-env@0.1.3
  - @spences10/pi-tui-modal@0.0.5

## 0.0.10

### Patch Changes

- 15cbd0a: Fix agent-dir isolation leaks and scope runtime environment
  mutations to disposed my-pi sessions safely
- Updated dependencies [15cbd0a]
  - @spences10/pi-project-trust@0.0.4

## 0.0.9

### Patch Changes

- 52cfb66: Add modal-first navigation dashboards for LSP and telemetry
  commands using shared Pi TUI modal primitives.
- f491150: Adds direct Restart all action to LSP modal home, matching
  UX epic navigation requirements cleanly.
- Updated dependencies [ee169f8]
  - @spences10/pi-tui-modal@0.0.4

## 0.0.8

### Patch Changes

- Updated dependencies [ca28246]
- Updated dependencies [34d64ec]
  - @spences10/pi-child-env@0.1.2
  - @spences10/pi-project-trust@0.0.3

## 0.0.7

### Patch Changes

- c41b71a: Centralize project trust policy across MCP, LSP, hooks, and
  untrusted mode with shared package.
- Updated dependencies [c41b71a]
  - @spences10/pi-project-trust@0.0.2

## 0.0.6

### Patch Changes

- Updated dependencies [8076ac6]
  - @spences10/pi-child-env@0.1.1

## 0.0.5

### Patch Changes

- 627f483: Standardize package READMEs with npm badges, Vite+/Vitest
  messaging, installation, and development docs.
- 6a85bee: Add shared child-process environment helper and prevent
  team-mode teammates inheriting full parent env secrets.
- Updated dependencies [6a85bee]
  - @spences10/pi-child-env@0.1.0

## 0.0.4

### Patch Changes

- 5c37302: Align workspace Pi dependencies and group Renovate updates
  to prevent duplicate extension API types.

## 0.0.3

### Patch Changes

- cf0d023: Restrict child process environment passthrough for MCP,
  LSP, and hook command execution safely by default.
- 0a72284: Gate project-local LSP binaries behind trust prompts before
  starting language servers.

## 0.0.2

### Patch Changes

- 381d549: Add LSP prompt guidance encouraging diagnostics, symbol
  lookup, references, and validation when tools are active.
- 0ef336d: Limit batched LSP diagnostics concurrency and preserve
  per-file failures instead of failing whole batches.

## 0.0.1

### Patch Changes

- a6ff57b: Extract MCP, LSP, and skills into public installable Pi
  workspace packages.
- 148aa42: Add recall and nopeek prompt reminder packages with
  background recall sync on session lifecycle.
