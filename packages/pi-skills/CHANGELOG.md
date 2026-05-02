# @spences10/pi-skills

## 0.0.10

### Patch Changes

- 132eff7: Refactor skill profiles into named skill sets with
  profile-based enablement and legacy config migration.

## 0.0.9

### Patch Changes

- 61a17ba: Refactor skills management UI into focused modules and add
  generic profile support with tests.
- ca3d5e5: Harden redaction, document eval workflow, align Node
  support, and clarify SQLite warning policy across packages.
- d8c5c5b: Replace hand-coded workspace dependency builds with pnpm
  graph-backed self tasks and script consistency tests.
- Updated dependencies [ca3d5e5]
- Updated dependencies [d8c5c5b]
  - @spences10/pi-tui-modal@0.0.5

## 0.0.8

### Patch Changes

- 57d754f: Add package smoke tests, MCP failure coverage, warning
  filtering, and agent-dir isolation documentation updates
- 15cbd0a: Fix agent-dir isolation leaks and scope runtime environment
  mutations to disposed my-pi sessions safely

## 0.0.7

### Patch Changes

- e711bd0: Add a modal home menu for skills management, imports,
  syncs, refresh summaries, and default policy selection.
- d425461: Add modal skill browsing with read-only detail views while
  preserving script-friendly list and show commands.
- Updated dependencies [ee169f8]
  - @spences10/pi-tui-modal@0.0.4

## 0.0.6

### Patch Changes

- Updated dependencies [bb2c70e]
  - @spences10/pi-tui-modal@0.0.3

## 0.0.5

### Patch Changes

- f6871b6: Show inline skill descriptions in modal rows while
  preserving selected item metadata details panel.
- c4356b9: Cap visible skill modal rows so selected item metadata
  remains visible below large lists.
- ab5ee75: Add shared padded TUI modals and replace bracket status
  labels with clearer terminal glyphs.
- Updated dependencies [f6871b6]
  - @spences10/pi-tui-modal@0.0.2

## 0.0.4

### Patch Changes

- 627f483: Standardize package READMEs with npm badges, Vite+/Vitest
  messaging, installation, and development docs.

## 0.0.3

### Patch Changes

- 5c37302: Align workspace Pi dependencies and group Renovate updates
  to prevent duplicate extension API types.

## 0.0.2

### Patch Changes

- 6dde715: Harden skill import paths and add Semgrep security scanning
  workflow badge.

## 0.0.1

### Patch Changes

- a6ff57b: Extract MCP, LSP, and skills into public installable Pi
  workspace packages.
- 148aa42: Add recall and nopeek prompt reminder packages with
  background recall sync on session lifecycle.
