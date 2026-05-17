# @spences10/pi-mcp

## 0.0.28

### Patch Changes

- ffea37e: Standardize shared dependency versions through pnpm catalog
  and align package dev dependencies for CI.
- Updated dependencies [ffea37e]
  - @spences10/pi-project-trust@0.0.7
  - @spences10/pi-child-env@0.1.5
  - @spences10/pi-tui-modal@0.0.16
  - @spences10/pi-context@0.0.18

## 0.0.27

### Patch Changes

- Updated dependencies [600dbac]
  - @spences10/pi-tui-modal@0.0.15
  - @spences10/pi-context@0.0.17

## 0.0.26

### Patch Changes

- e58b031: Add missing per-file smoke tests across packages and enable
  full test runs for weakly covered modules
- 8aa7681: Refactor MCP, prompt presets, and skills modules into
  semantic files with focused tests.
- Updated dependencies [2305de8]
- Updated dependencies [e58b031]
  - @spences10/pi-tui-modal@0.0.14
  - @spences10/pi-context@0.0.16

## 0.0.25

### Patch Changes

- bea8707: Add package-specific homepage links so Pi gallery pages
  point to each package README.
- 3e91b90: Add shared package gallery preview image to all Pi package
  manifests.
- Updated dependencies [e14275b]
- Updated dependencies [bea8707]
- Updated dependencies [7db4cfc]
- Updated dependencies [3e91b90]
  - @spences10/pi-context@0.0.15

## 0.0.24

### Patch Changes

- 8944bf8: Move Pi core runtime packages to peer dependencies for
  safer external extension installs.
- Updated dependencies [8944bf8]
  - @spences10/pi-tui-modal@0.0.13
  - @spences10/pi-context@0.0.14

## 0.0.23

### Patch Changes

- Updated dependencies [c771d16]
  - @spences10/pi-tui-modal@0.0.12
  - @spences10/pi-context@0.0.13

## 0.0.22

### Patch Changes

- Updated dependencies [7fcd066]
  - @spences10/pi-tui-modal@0.0.11
  - @spences10/pi-context@0.0.12

## 0.0.21

### Patch Changes

- Updated dependencies [0f63525]
  - @spences10/pi-context@0.0.11
  - @spences10/pi-tui-modal@0.0.10

## 0.0.20

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
  - @spences10/pi-context@0.0.10

## 0.0.19

### Patch Changes

- Updated dependencies [fd8a6ae]
  - @spences10/pi-tui-modal@0.0.8
  - @spences10/pi-context@0.0.9

## 0.0.18

### Patch Changes

- Updated dependencies [1ef0bb8]
  - @spences10/pi-context@0.0.8

## 0.0.17

### Patch Changes

- 9bbacf1: Improve pi-context chunk retrieval UX with first chunk
  receipts, aliases, and helpful miss messages.
- Updated dependencies [9bbacf1]
  - @spences10/pi-tui-modal@0.0.7
  - @spences10/pi-context@0.0.7

## 0.0.16

### Patch Changes

- 92b9ff0: Add configurable context sidecar retention, storage caps,
  capture thresholds, and nested settings menus.
- Updated dependencies [92b9ff0]
  - @spences10/pi-context@0.0.6

## 0.0.15

### Patch Changes

- Updated dependencies [7b27f9e]
  - @spences10/pi-tui-modal@0.0.6
  - @spences10/pi-context@0.0.5

## 0.0.14

### Patch Changes

- aa8cfb7: Improve extension UX with context modal, MCP profile
  picker, clearer redaction naming, and team cleanup.
- Updated dependencies [1745de7]
- Updated dependencies [aa8cfb7]
- Updated dependencies [f4203a0]
- Updated dependencies [63438fd]
- Updated dependencies [c7d0025]
- Updated dependencies [fd9a2b2]
- Updated dependencies [03e02a8]
- Updated dependencies [35d85b9]
- Updated dependencies [2fa5ae5]
  - @spences10/pi-context@0.0.4

## 0.0.13

### Patch Changes

- ca3d5e5: Harden redaction, document eval workflow, align Node
  support, and clarify SQLite warning policy across packages.
- 0495264: Split LSP, telemetry, MCP, and team store god files into
  focused modules with colocated tests.
- f3c5600: Fix redaction false positives for source variables and
  clear MCP request timers after completion.
- d8c5c5b: Replace hand-coded workspace dependency builds with pnpm
  graph-backed self tasks and script consistency tests.
- Updated dependencies [ca3d5e5]
- Updated dependencies [d8c5c5b]
  - @spences10/pi-project-trust@0.0.5
  - @spences10/pi-child-env@0.1.3
  - @spences10/pi-tui-modal@0.0.5
  - @spences10/pi-context@0.0.3

## 0.0.12

### Patch Changes

- 2552f1f: Add comprehensive context sidecar eval tests, improve line
  chunking
- 2153385: Fix headless MCP tool registration so selected tools are
  available before non-interactive agent runs start.
- c5fd4e8: Add SQLite context sidecar for oversized tool output with
  MCP integration and telemetry eval harness.
- 57d754f: Add package smoke tests, MCP failure coverage, warning
  filtering, and agent-dir isolation documentation updates
- 15cbd0a: Fix agent-dir isolation leaks and scope runtime environment
  mutations to disposed my-pi sessions safely
- Updated dependencies [2552f1f]
- Updated dependencies [15cbd0a]
  - @spences10/pi-context@0.0.2
  - @spences10/pi-project-trust@0.0.4

## 0.0.11

### Patch Changes

- ee169f8: Add shared modal input and confirm primitives, wire MCP
  profile and restore flows, and stabilize settings modal row
  selection alignment.
- Updated dependencies [ee169f8]
  - @spences10/pi-tui-modal@0.0.4

## 0.0.10

### Patch Changes

- bb2c70e: Add modal-first menu navigation with scrollable detail
  views for team and MCP extensions
- Updated dependencies [bb2c70e]
  - @spences10/pi-tui-modal@0.0.3

## 0.0.9

### Patch Changes

- de8ba83: Add MCP server TUI modal for searchable enable/disable
  toggles with persisted config state.
- 847bfd9: Add MCP backup, restore, and profile commands for reusable
  server configuration management.
- Updated dependencies [ca28246]
- Updated dependencies [f6871b6]
- Updated dependencies [34d64ec]
  - @spences10/pi-child-env@0.1.2
  - @spences10/pi-tui-modal@0.0.2
  - @spences10/pi-project-trust@0.0.3

## 0.0.8

### Patch Changes

- c41b71a: Centralize project trust policy across MCP, LSP, hooks, and
  untrusted mode with shared package.
- Updated dependencies [c41b71a]
  - @spences10/pi-project-trust@0.0.2

## 0.0.7

### Patch Changes

- Updated dependencies [8076ac6]
  - @spences10/pi-child-env@0.1.1

## 0.0.6

### Patch Changes

- 627f483: Standardize package READMEs with npm badges, Vite+/Vitest
  messaging, installation, and development docs.
- 6a85bee: Add shared child-process environment helper and prevent
  team-mode teammates inheriting full parent env secrets.
- Updated dependencies [6a85bee]
  - @spences10/pi-child-env@0.1.0

## 0.0.5

### Patch Changes

- 30aad75: Add packaged team mode with RPC teammates, mailboxes,
  background orchestration, locking, and stale process detection.

## 0.0.4

### Patch Changes

- 5c37302: Align workspace Pi dependencies and group Renovate updates
  to prevent duplicate extension API types.

## 0.0.3

### Patch Changes

- e84f2a4: Adds MCP metadata trust handling, suppressing untrusted
  descriptions and schema prose against prompt injection risk.

## 0.0.2

### Patch Changes

- edc9723: Gate project-local MCP config behind trust prompts before
  spawning configured servers.
- cf0d023: Restrict child process environment passthrough for MCP,
  LSP, and hook command execution safely by default.
- 4f16b43: Add MCP tool output truncation with temp file preservation
  for oversized server responses.

## 0.0.1

### Patch Changes

- a6ff57b: Extract MCP, LSP, and skills into public installable Pi
  workspace packages.
- 148aa42: Add recall and nopeek prompt reminder packages with
  background recall sync on session lifecycle.
