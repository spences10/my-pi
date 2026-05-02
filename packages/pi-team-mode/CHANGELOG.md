# @spences10/pi-team-mode

## 0.0.10

### Patch Changes

- c512148: Refactor prompt presets and team command handler into
  focused modules, reducing god file complexity.
- ca3d5e5: Harden redaction, document eval workflow, align Node
  support, and clarify SQLite warning policy across packages.
- 0495264: Split LSP, telemetry, MCP, and team store god files into
  focused modules with colocated tests.
- d8c5c5b: Replace hand-coded workspace dependency builds with pnpm
  graph-backed self tasks and script consistency tests.
- Updated dependencies [ca3d5e5]
- Updated dependencies [f3c5600]
- Updated dependencies [d8c5c5b]
  - @spences10/pi-child-env@0.1.3
  - @spences10/pi-tui-modal@0.0.5
  - @spences10/pi-redact@0.0.4

## 0.0.9

### Patch Changes

- 117f765: Fix CLI flag parsing and team-mode teammate spawning
  extension path resolution.
- dcb9909: Publish API types, clean package contents, and redact
  persisted team event logs safely.

## 0.0.8

### Patch Changes

- 0d8947c: Harden teammate worktree assignment by refusing active
  duplicate path or branch assignments and validating git worktree
  path and branch reuse before spawning.
- cc0a396: Improve team-mode mailbox semantics, reliability tests,
  child recovery, and orchestration comparison documentation.
- f65b4c7: Harden orphan teammate shutdown by verifying process
  identity before signalling and documenting platform cleanup
  limitations.
- 7e3ccf1: Fix non-modal team switching and include docs in published
  pi-team-mode package tarball.
- 6a55331: Fix team tool schema to use top-level object for provider
  compatibility while preserving action validation.
- ff5563b: Prevent teardown-time RPC runner state writes from failing
  after team storage cleanup.
- 7d9b363: Fix flaky team-mode RPC e2e by avoiding modal UI paths
  during RPC command execution.
- 329dc7c: Replace the catch-all team tool parameter schema with
  action-specific variants and runtime validation for required fields.
- 3ed0e0b: Add team modal mutation flows for tasks, members,
  assignment, teammate messaging, waiting, and shutdown actions.
- 75d1dc2: Split team-mode bootstrap into focused command handling,
  tool execution, activity polling, UI status, formatting, config,
  runner orchestration, team tool parameter validation, and workspace
  guard modules.
- Updated dependencies [ee169f8]
  - @spences10/pi-tui-modal@0.0.4

## 0.0.7

### Patch Changes

- bb2c70e: Add modal-first menu navigation with scrollable detail
  views for team and MCP extensions
- e114ba3: Replace blocking team-store lock waits with async polling,
  preserving stale recovery and event-loop responsiveness coverage
- Updated dependencies [bb2c70e]
  - @spences10/pi-tui-modal@0.0.3

## 0.0.6

### Patch Changes

- ab5ee75: Add shared padded TUI modals and replace bracket status
  labels with clearer terminal glyphs.
- 145df7f: Add real RPC child tests, runner cleanup hooks, and
  event-driven teammate heartbeat updates.
- e205248: Add team dashboard modal with transcript usage summaries
  and joined completed task result aggregation workflow
- 3b910ce: Prevent teammate sessions from spawning nested teams and
  handle legacy team metadata safely.
- 0d9edc9: Harden team mode validation, RPC lifecycle handling, task
  retrieval, duplicate spawn protection, and documentation.
- 028813b: Add resilient team state loading, task lifecycle commands,
  blocked notifications, and clear field semantics support.
- 903653e: Recover orphaned teammate processes after lead restart and
  expose attached versus orphaned running states.
- bccf934: Add isolated teammate worktrees and snake case team
  metadata for safer mutating parallel work.
- 52d224e: Add real team-mode RPC integration tests for spawning,
  mailbox delivery, nested guards, and orphan recovery
- 34d64ec: Add reusable teammate profiles with model, prompt, tool,
  skill limits, and project trust controls.
- ce770c8: Fix mailbox acknowledgement semantics so delivered teammate
  messages remain durable until explicitly processed.
- 20c3a45: Fix team-mode RPC spawning to avoid duplicate extension
  loading in my-pi teammate child processes.
- c1d5c27: Improve team mode UX with modal action picker, UI settings,
  and task browsing overlays.
- Updated dependencies [ca28246]
- Updated dependencies [f6871b6]
  - @spences10/pi-child-env@0.1.2
  - @spences10/pi-tui-modal@0.0.2

## 0.0.5

### Patch Changes

- c7bed23: Improve team UI density, switching, styling, and reduce
  redundant full-mode footer status.
- 77e89a8: Stabilize team mode: task claiming, stale-lock recovery,
  fake-tool gating, RPC waits, UX/docs.

## 0.0.4

### Patch Changes

- 4a48fcc: Polish team UI startup behavior, status controls,
  completion notifications, stale task handling, and child-env
  packaging.

## 0.0.3

### Patch Changes

- 8076ac6: Polish team-mode UI controls and preserve Pi agent dir in
  child environments.
- Updated dependencies [8076ac6]
  - @spences10/pi-child-env@0.1.1

## 0.0.2

### Patch Changes

- 627f483: Standardize package READMEs with npm badges, Vite+/Vitest
  messaging, installation, and development docs.
- 6a85bee: Add shared child-process environment helper and prevent
  team-mode teammates inheriting full parent env secrets.
- Updated dependencies [6a85bee]
  - @spences10/pi-child-env@0.1.0

## 0.0.1

### Patch Changes

- 30aad75: Add packaged team mode with RPC teammates, mailboxes,
  background orchestration, locking, and stale process detection.
- 16c677b: Add team mode prompt shim so agents understand
  orchestration before and after team creation.
