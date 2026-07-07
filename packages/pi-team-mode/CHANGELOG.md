# @spences10/pi-team-mode

## 0.0.45

### Patch Changes

- 952589f: Add shared SQLite busy retry and transaction helpers across
  database-backed Pi packages.
- 85f7efb: Add shared SQLite helpers for busy handling and consistent
  pragmas across Pi database-backed packages.
- 7fb65b2: Fix team member_spawn to start teammates immediately when
  an initial task message is provided.
- Updated dependencies [952589f]
- Updated dependencies [85f7efb]
  - @spences10/pi-sqlite-core@0.0.2

## 0.0.44

### Patch Changes

- 459eaff: Team Mode keeps compact session lists and mailbox
  confirmations terse while preserving explicit full retrieval.

## 0.0.43

### Patch Changes

- 3d146ba: Team Mode now delivers visible teammate messages live or in
  background across the same resumable session.
- cb58236: Prevent Team Mode EEXIST crashes, defer broker startup, and
  throttle heartbeat writes for long sessions.

## 0.0.42

### Patch Changes

- e9de78a: Create visible resumable Team Mode teammates that wake on
  sends and preserve auditable two-way session history.

## 0.0.41

### Patch Changes

- 101004a: Serialize RPC teammate lifecycle events and wait for
  shutdown to prevent temp cleanup races.
- ba4ceed: Update team orchestration guidance to prefer shared cwd
  mutation and reserve worktrees for explicit isolation.
- 454e469: Remove RPC teammate spawning and runner/task orchestration
  from team mode, leaving peer-session coordination through mailboxes,
  groups, and artifacts.

## 0.0.40

### Patch Changes

- 3378dfb: Mark stale PID-backed coordination sessions offline before
  listing or targeting peer sessions in team mode.
- de93334: Disconnect idle MCP servers by default and clean up
  interrupted team-mode e2e temp directories.

## 0.0.39

### Patch Changes

- 2f326d4: Compact team mailbox auto-injection by default; require
  explicit full mode for message bodies.
- 1a8cc19: Add focused chunk retrieval for long team messages and
  artifacts without loading full bodies.

## 0.0.38

### Patch Changes

- 855016d: Refactor team coordination database modules and add
  structured session artifacts for efficient inter-session information
  exchange.
- f739295: Auto-register natural-language standby sessions and prevent
  accidental teammate spawning when standby sessions already exist.

## 0.0.37

### Patch Changes

- 47bd8e2: Fix team session discovery with full IDs, prefix targeting,
  and clearer ambiguous target errors.

## 0.0.36

### Patch Changes

- 4bca247: Migrate existing coordination databases to add thinking
  level support without breaking published users.

## 0.0.35

### Patch Changes

- 9215b58: Inject peer group identity and thinking level into
  coordinated sessions for clearer orchestration roles.
- 18db7ef: Add push-based peer session coordination with self-injected
  messages, groups, registration, and SQLite fallback.

## 0.0.34

### Patch Changes

- 6e23c95: Add explicit team spawn model and thinking selection with
  registry validation and clearer teammate status display.

## 0.0.33

### Patch Changes

- 9da9a7a: Forward observability routing to spawned teammates with
  team pool grouping and per-member dashboard tags.

## 0.0.32

### Patch Changes

- b282723: Update Pi 0.78.1 integration: refresh docs paths, lockfile,
  and TUI mode detection guards.

## 0.0.31

### Patch Changes

- ed18144: Split team modal dashboard and member action flows into
  focused helper modules with preserved exports.
- 24950eb: Add modal coverage and extract shared team member picker to
  remove duplicated refactor logic.
- 50ccdcd: Split team store lock, type, member, task, and message
  helpers into focused tested modules.
- 4536a3a: Split team-mode tool executor task and message actions into
  focused helper modules with co-located tests.

## 0.0.30

### Patch Changes

- 1d72ec7: Split team-mode RPC runner helpers into focused command,
  environment, and protocol modules with co-located tests.

## 0.0.29

### Patch Changes

- 96071d3: Add package preview image to package READMEs so npm pages
  display consistent project branding.
- Updated dependencies [96071d3]
  - @spences10/pi-child-env@0.1.8
  - @spences10/pi-tui-modal@0.0.20
  - @spences10/pi-redact@0.0.12

## 0.0.28

### Patch Changes

- d938c19: Add peer message threading, expiry metadata, and wait
  support to pi-team-mode mailbox workflows.

## 0.0.27

### Patch Changes

- Updated dependencies [7d90676]
  - @spences10/pi-tui-modal@0.0.19

## 0.0.26

### Patch Changes

- 599b355: Improve package README openings and descriptions to
  emphasize user benefits and clarify pi-skills/pi-recall positioning.
- Updated dependencies [599b355]
  - @spences10/pi-child-env@0.1.7
  - @spences10/pi-tui-modal@0.0.18
  - @spences10/pi-redact@0.0.11

## 0.0.25

### Patch Changes

- a040ea3: Standardize package scripts through Vite+ and refresh
  README badges/development guidance across published packages.
- Updated dependencies [a040ea3]
  - @spences10/pi-child-env@0.1.6
  - @spences10/pi-tui-modal@0.0.17
  - @spences10/pi-redact@0.0.10

## 0.0.24

### Patch Changes

- ffea37e: Standardize shared dependency versions through pnpm catalog
  and align package dev dependencies for CI.
- Updated dependencies [ffea37e]
  - @spences10/pi-child-env@0.1.5
  - @spences10/pi-tui-modal@0.0.16
  - @spences10/pi-redact@0.0.9

## 0.0.23

### Patch Changes

- Updated dependencies [600dbac]
  - @spences10/pi-tui-modal@0.0.15

## 0.0.22

### Patch Changes

- cd89be0: Add bulk team shutdown commands and warnings for completed
  teams with lingering teammate processes.
- e58b031: Add missing per-file smoke tests across packages and enable
  full test runs for weakly covered modules
- f32f879: Refactor team command handler into semantic command modules
  with focused tests for new files.
- Updated dependencies [2305de8]
- Updated dependencies [e58b031]
  - @spences10/pi-tui-modal@0.0.14

## 0.0.21

### Patch Changes

- bea8707: Add package-specific homepage links so Pi gallery pages
  point to each package README.
- 3e91b90: Add shared package gallery preview image to all Pi package
  manifests.
- Updated dependencies [bea8707]
- Updated dependencies [3e91b90]
  - @spences10/pi-redact@0.0.8

## 0.0.20

### Patch Changes

- 8944bf8: Move Pi core runtime packages to peer dependencies for
  safer external extension installs.
- Updated dependencies [8944bf8]
  - @spences10/pi-tui-modal@0.0.13
  - @spences10/pi-redact@0.0.7

## 0.0.19

### Patch Changes

- Updated dependencies [c771d16]
  - @spences10/pi-tui-modal@0.0.12

## 0.0.18

### Patch Changes

- Updated dependencies [7fcd066]
  - @spences10/pi-tui-modal@0.0.11

## 0.0.17

### Patch Changes

- 0f63525: Split oversized context, modal, and team command modules
  into smaller focused implementation files.
- Updated dependencies [0f63525]
  - @spences10/pi-tui-modal@0.0.10

## 0.0.16

### Patch Changes

- dacf04d: Simplify skills TUI navigation, split importable skill
  actions, and clarify profile policy/rule wording.
- 44136fe: Migrate Pi core dependencies from Mario Zechner scope to
  Earendil Works package scope.
- Updated dependencies [dacf04d]
- Updated dependencies [44136fe]
  - @spences10/pi-child-env@0.1.4
  - @spences10/pi-tui-modal@0.0.9
  - @spences10/pi-redact@0.0.6

## 0.0.15

### Patch Changes

- 3a8937a: Make team wait actions non-blocking so lead sessions remain
  available while teammates continue background work.
- fd8a6ae: Make team dashboard live-refresh and show recent mailbox
  message previews for relay verification.
- Updated dependencies [fd8a6ae]
  - @spences10/pi-tui-modal@0.0.8

## 0.0.14

### Patch Changes

- 1ef0bb8: Fix skills reload using fresh profile config so enabled
  cl-\* skills appear after TUI reload.

## 0.0.13

### Patch Changes

- 9bbacf1: Improve pi-context chunk retrieval UX with first chunk
  receipts, aliases, and helpful miss messages.
- Updated dependencies [9bbacf1]
  - @spences10/pi-tui-modal@0.0.7
  - @spences10/pi-redact@0.0.5

## 0.0.12

### Patch Changes

- 7b27f9e: Add rounded modal borders, dynamic height budgeting, and
  scrollable team dashboard for small terminals.
- Updated dependencies [7b27f9e]
  - @spences10/pi-tui-modal@0.0.6

## 0.0.11

### Patch Changes

- aa8cfb7: Improve extension UX with context modal, MCP profile
  picker, clearer redaction naming, and team cleanup.

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
