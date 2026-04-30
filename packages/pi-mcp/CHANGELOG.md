# @spences10/pi-mcp

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
