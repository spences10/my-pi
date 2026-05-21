# my-pi

## 0.1.61

### Patch Changes

- bc33d49: Consolidate scattered user config into canonical settings
  file with one-way legacy migration and documented ownership.
- Updated dependencies [96071d3]
  - @spences10/pi-project-trust@0.0.10
  - @spences10/pi-tui-modal@0.0.20
  - @spences10/pi-themes@0.0.8

## 0.1.60

## 0.1.59

## 0.1.58

### Patch Changes

- 9b40fe4: Add generated startup preview image to README and version
  workflow

## 0.1.57

## 0.1.56

### Patch Changes

- 6c288a7: Update Pi catalog dependencies to 0.75.3 for latest
  upstream runtime and fetch stability fixes.

## 0.1.55

### Patch Changes

- 86192a9: Update pi-coding-agent catalog dependency to 0.75.0 and
  refresh lockfile resolution entries.

## 0.1.54

### Patch Changes

- Updated dependencies [7d90676]
  - @spences10/pi-tui-modal@0.0.19

## 0.1.53

### Patch Changes

- 2424977: Align Markdown parsing and skill discovery with Pi docs
  using YAML frontmatter and recursive scanning.
- Updated dependencies [599b355]
  - @spences10/pi-project-trust@0.0.9
  - @spences10/pi-tui-modal@0.0.18
  - @spences10/pi-themes@0.0.7

## 0.1.52

## 0.1.51

### Patch Changes

- Updated dependencies [a040ea3]
  - @spences10/pi-project-trust@0.0.8
  - @spences10/pi-tui-modal@0.0.17
  - @spences10/pi-themes@0.0.6

## 0.1.50

### Patch Changes

- c11697a: Extract configurable Pi footer package and decouple prompt
  presets into status publisher only.
- ffea37e: Standardize shared dependency versions through pnpm catalog
  and align package dev dependencies for CI.
- Updated dependencies [ffea37e]
  - @spences10/pi-project-trust@0.0.7
  - @spences10/pi-tui-modal@0.0.16

## 0.1.49

### Patch Changes

- 11ef5c9: Add skill importer as my-pi built-in extension with slash
  command and guarded import workflows.
- 3cb9f3c: Extract external skill importing into pi-skill-importer and
  stop treating Claude skills as managed Pi skills.
- f7b5717: Add GitHub skill search with preview-first workflow and
  explicit untrusted skill install warnings.
- 600dbac: Show selected GitHub skill source and path dynamically in
  search result picker footer.
- 2e275d2: Simplify pi-skills around Pi and GitHub management after
  extracting external import functionality.
- Updated dependencies [600dbac]
  - @spences10/pi-tui-modal@0.0.15

## 0.1.48

### Patch Changes

- 3f1eff0: Refactor hooks resolution into semantic modules for config
  parsing, payloads, execution, trust, and types.
- 8aa7681: Refactor MCP, prompt presets, and skills modules into
  semantic files with focused tests.
- Updated dependencies [2305de8]
- Updated dependencies [e58b031]
  - @spences10/pi-tui-modal@0.0.14

## 0.1.47

### Patch Changes

- Updated dependencies [bea8707]
- Updated dependencies [3e91b90]
  - @spences10/pi-themes@0.0.5

## 0.1.46

## 0.1.45

### Patch Changes

- 8944bf8: Move Pi core runtime packages to peer dependencies for
  safer external extension installs.
- Updated dependencies [8944bf8]
  - @spences10/pi-tui-modal@0.0.13

## 0.1.44

### Patch Changes

- c771d16: Add VS Code-style Git staging UI with selectable files and
  pi-tui primitive-based modal controls.
- Updated dependencies [c771d16]
  - @spences10/pi-tui-modal@0.0.12

## 0.1.43

### Patch Changes

- 2f62e0a: Remove personal wording from public docs and describe my-pi
  as opinionated, reusable tooling instead.
- Updated dependencies [7fcd066]
  - @spences10/pi-tui-modal@0.0.11

## 0.1.42

### Patch Changes

- Updated dependencies [0f63525]
  - @spences10/pi-tui-modal@0.0.10

## 0.1.41

### Patch Changes

- 5d8de6a: Document Svelte guardrails status, disabling options,
  configuration, built-in behavior, and blocked-write semantics.

## 0.1.40

### Patch Changes

- dbff3b4: Fix pnpx installs by keeping runtime helper packages as
  required dependencies while optional extensions remain skippable.

## 0.1.39

### Patch Changes

- 33622bc: Register coding preferences as a built-in extension so it
  appears in `/extensions`.

## 0.1.38

### Patch Changes

- 3b48e2f: Move built-in extension packages to optional dependencies
  and gracefully skip unavailable extensions at startup.

## 0.1.37

### Patch Changes

- cf3e775: Enable Svelte guardrails by default and clarify blocked
  writes must be retried without $effect.
- dd49073: Add PreToolUse hook blocking and opt-in Svelte guardrails
  package preventing $effect writes.
- Updated dependencies [cf3e775]
  - @spences10/pi-svelte-guardrails@0.0.2

## 0.1.36

### Patch Changes

- 23136b8: Add contextual project skill discovery and profile-based
  activation for .agents and repository-specific skills.
- 6786aab: Add regression tests for YAML frontmatter prompts and
  TypeScript extension loading after Pi 0.73.1.
- dacf04d: Simplify skills TUI navigation, split importable skill
  actions, and clarify profile policy/rule wording.
- 90e3bc9: Suppress upstream Pi update banners for installed my-pi
  users while preserving checks in development.
- 44136fe: Migrate Pi core dependencies from Mario Zechner scope to
  Earendil Works package scope.
- Updated dependencies [23136b8]
- Updated dependencies [dacf04d]
- Updated dependencies [44136fe]
  - @spences10/pi-skills@0.0.14
  - @spences10/pi-confirm-destructive@0.0.8
  - @spences10/pi-project-trust@0.0.6
  - @spences10/pi-sqlite-tools@0.0.6
  - @spences10/pi-omnisearch@0.0.6
  - @spences10/pi-child-env@0.1.4
  - @spences10/pi-team-mode@0.0.16
  - @spences10/pi-telemetry@0.0.9
  - @spences10/pi-tui-modal@0.0.9
  - @spences10/pi-context@0.0.10
  - @spences10/pi-nopeek@0.0.6
  - @spences10/pi-recall@0.0.6
  - @spences10/pi-redact@0.0.6
  - @spences10/pi-lsp@0.0.17
  - @spences10/pi-mcp@0.0.20

## 0.1.35

### Patch Changes

- Updated dependencies [3a8937a]
- Updated dependencies [fd8a6ae]
  - @spences10/pi-team-mode@0.0.15
  - @spences10/pi-tui-modal@0.0.8
  - @spences10/pi-context@0.0.9
  - @spences10/pi-lsp@0.0.16
  - @spences10/pi-mcp@0.0.19
  - @spences10/pi-skills@0.0.13
  - @spences10/pi-telemetry@0.0.8

## 0.1.34

### Patch Changes

- 1ef0bb8: Fix skills reload using fresh profile config so enabled
  cl-\* skills appear after TUI reload.
- Updated dependencies [1ef0bb8]
  - @spences10/pi-team-mode@0.0.14
  - @spences10/pi-context@0.0.8
  - @spences10/pi-lsp@0.0.15
  - @spences10/pi-mcp@0.0.18

## 0.1.33

### Patch Changes

- fadfd9a: Startup splash gradients now derive from active theme
  colors while preserving truecolor gradient rendering support.
- 091d232: Add Davis-style gradient startup header with centered
  model/project subtitle and live model selection updates.
- 78640fb: Add custom My-Pi startup header with truecolor pixel fill
  and box-drawing outline styling for clarity.

## 0.1.32

### Patch Changes

- 9bbacf1: Improve pi-context chunk retrieval UX with first chunk
  receipts, aliases, and helpful miss messages.
- Updated dependencies [9bbacf1]
  - @spences10/pi-confirm-destructive@0.0.7
  - @spences10/pi-sqlite-tools@0.0.5
  - @spences10/pi-omnisearch@0.0.5
  - @spences10/pi-team-mode@0.0.13
  - @spences10/pi-telemetry@0.0.7
  - @spences10/pi-tui-modal@0.0.7
  - @spences10/pi-context@0.0.7
  - @spences10/pi-nopeek@0.0.5
  - @spences10/pi-recall@0.0.5
  - @spences10/pi-redact@0.0.5
  - @spences10/pi-skills@0.0.12
  - @spences10/pi-lsp@0.0.14
  - @spences10/pi-mcp@0.0.17

## 0.1.31

### Patch Changes

- 92b9ff0: Add configurable context sidecar retention, storage caps,
  capture thresholds, and nested settings menus.
- Updated dependencies [92b9ff0]
  - @spences10/pi-context@0.0.6
  - @spences10/pi-mcp@0.0.16

## 0.1.30

### Patch Changes

- Updated dependencies [7b27f9e]
  - @spences10/pi-team-mode@0.0.12
  - @spences10/pi-tui-modal@0.0.6
  - @spences10/pi-context@0.0.5
  - @spences10/pi-lsp@0.0.13
  - @spences10/pi-mcp@0.0.15
  - @spences10/pi-skills@0.0.11
  - @spences10/pi-telemetry@0.0.6

## 0.1.29

### Patch Changes

- aa8cfb7: Improve extension UX with context modal, MCP profile
  picker, clearer redaction naming, and team cleanup.
- f4203a0: Document context sidecar coverage policy and prevent
  recursive indexing of context and MCP receipts.
- 35d85b9: Improve context receipts, scoped stats, previews, and
  documentation for clearer sidecar retrieval UX.
- Updated dependencies [8a6c2c7]
- Updated dependencies [1745de7]
- Updated dependencies [aa8cfb7]
- Updated dependencies [f4203a0]
- Updated dependencies [63438fd]
- Updated dependencies [132eff7]
- Updated dependencies [c7d0025]
- Updated dependencies [fd9a2b2]
- Updated dependencies [03e02a8]
- Updated dependencies [35d85b9]
- Updated dependencies [2fa5ae5]
  - @spences10/pi-lsp@0.0.12
  - @spences10/pi-context@0.0.4
  - @spences10/pi-team-mode@0.0.11
  - @spences10/pi-mcp@0.0.14
  - @spences10/pi-skills@0.0.10

## 0.1.28

### Patch Changes

- Document pnpm install build approvals for Pi runtime dependencies.

## 0.1.27

### Patch Changes

- deb439d: Add a committed smoke eval suite with objective command
  assertions and a local suite runner.
- c512148: Refactor prompt presets and team command handler into
  focused modules, reducing god file complexity.
- ca3d5e5: Harden redaction, document eval workflow, align Node
  support, and clarify SQLite warning policy across packages.
- eb36714: Lazy-load built-in extension packages so disabled
  capabilities are not imported during root API startup.
- 2552d22: Add built-in extension registry metadata to derive loaders,
  CLI disable flags, options, and consistency tests.
- d8c5c5b: Replace hand-coded workspace dependency builds with pnpm
  graph-backed self tasks and script consistency tests.
- Updated dependencies [c512148]
- Updated dependencies [61a17ba]
- Updated dependencies [ca3d5e5]
- Updated dependencies [0495264]
- Updated dependencies [f3c5600]
- Updated dependencies [d8c5c5b]
  - @spences10/pi-team-mode@0.0.10
  - @spences10/pi-skills@0.0.9
  - @spences10/pi-confirm-destructive@0.0.6
  - @spences10/pi-project-trust@0.0.5
  - @spences10/pi-sqlite-tools@0.0.4
  - @spences10/pi-omnisearch@0.0.4
  - @spences10/pi-child-env@0.1.3
  - @spences10/pi-telemetry@0.0.5
  - @spences10/pi-tui-modal@0.0.5
  - @spences10/pi-context@0.0.3
  - @spences10/pi-nopeek@0.0.4
  - @spences10/pi-recall@0.0.4
  - @spences10/pi-redact@0.0.4
  - @spences10/pi-themes@0.0.4
  - @spences10/pi-lsp@0.0.11
  - @spences10/pi-mcp@0.0.13

## 0.1.26

### Patch Changes

- 536bba9: Align thinking level handling with model capabilities and
  document Xiaomi MiMo provider in CLI docs.
- 5ddd3a0: Suppress Node SQLite experimental warnings before sqlite
  imports in CLI and test environments.

## 0.1.25

### Patch Changes

- 117f765: Fix CLI flag parsing and team-mode teammate spawning
  extension path resolution.
- c5fd4e8: Add SQLite context sidecar for oversized tool output with
  MCP integration and telemetry eval harness.
- dcb9909: Publish API types, clean package contents, and redact
  persisted team event logs safely.
- 57d754f: Add package smoke tests, MCP failure coverage, warning
  filtering, and agent-dir isolation documentation updates
- 15cbd0a: Fix agent-dir isolation leaks and scope runtime environment
  mutations to disposed my-pi sessions safely
- Updated dependencies [117f765]
- Updated dependencies [2552f1f]
- Updated dependencies [2153385]
- Updated dependencies [fdaf682]
- Updated dependencies [c5fd4e8]
- Updated dependencies [dcb9909]
- Updated dependencies [57d754f]
- Updated dependencies [15cbd0a]
  - @spences10/pi-team-mode@0.0.9
  - @spences10/pi-context@0.0.2
  - @spences10/pi-mcp@0.0.12
  - @spences10/pi-themes@0.0.3
  - @spences10/pi-skills@0.0.8
  - @spences10/pi-project-trust@0.0.4
  - @spences10/pi-lsp@0.0.10

## 0.1.24

### Patch Changes

- 52cfb66: Add modal-first navigation dashboards for LSP and telemetry
  commands using shared Pi TUI modal primitives.
- 7d9b363: Fix flaky team-mode RPC e2e by avoiding modal UI paths
  during RPC command execution.
- 2cbb408: Build root CLI before package test runs so e2e tests work
  in clean CI.
- Updated dependencies [0d8947c]
- Updated dependencies [cc0a396]
- Updated dependencies [52cfb66]
- Updated dependencies [f65b4c7]
- Updated dependencies [7e3ccf1]
- Updated dependencies [e711bd0]
- Updated dependencies [f491150]
- Updated dependencies [d425461]
- Updated dependencies [ee169f8]
- Updated dependencies [6a55331]
- Updated dependencies [ff5563b]
- Updated dependencies [7d9b363]
- Updated dependencies [329dc7c]
- Updated dependencies [3ed0e0b]
- Updated dependencies [75d1dc2]
  - @spences10/pi-team-mode@0.0.8
  - @spences10/pi-telemetry@0.0.4
  - @spences10/pi-lsp@0.0.9
  - @spences10/pi-skills@0.0.7
  - @spences10/pi-tui-modal@0.0.4
  - @spences10/pi-mcp@0.0.11

## 0.1.23

### Patch Changes

- Updated dependencies [bb2c70e]
- Updated dependencies [e114ba3]
  - @spences10/pi-team-mode@0.0.7
  - @spences10/pi-tui-modal@0.0.3
  - @spences10/pi-mcp@0.0.10
  - @spences10/pi-skills@0.0.6

## 0.1.22

### Patch Changes

- ca28246: Publish themes separately and remove installable Pi package
  metadata from shared helper packages.
- ab5ee75: Add shared padded TUI modals and replace bracket status
  labels with clearer terminal glyphs.
- 34d64ec: Add reusable teammate profiles with model, prompt, tool,
  skill limits, and project trust controls.
- de8ba83: Add MCP server TUI modal for searchable enable/disable
  toggles with persisted config state.
- 847bfd9: Add MCP backup, restore, and profile commands for reusable
  server configuration management.
- Updated dependencies [ca28246]
- Updated dependencies [f6871b6]
- Updated dependencies [c4356b9]
- Updated dependencies [ab5ee75]
- Updated dependencies [145df7f]
- Updated dependencies [e205248]
- Updated dependencies [3b910ce]
- Updated dependencies [0d9edc9]
- Updated dependencies [028813b]
- Updated dependencies [903653e]
- Updated dependencies [bccf934]
- Updated dependencies [52d224e]
- Updated dependencies [34d64ec]
- Updated dependencies [de8ba83]
- Updated dependencies [847bfd9]
- Updated dependencies [ce770c8]
- Updated dependencies [20c3a45]
- Updated dependencies [c1d5c27]
  - @spences10/pi-child-env@0.1.2
  - @spences10/pi-themes@0.0.2
  - @spences10/pi-tui-modal@0.0.2
  - @spences10/pi-skills@0.0.5
  - @spences10/pi-team-mode@0.0.6
  - @spences10/pi-project-trust@0.0.3
  - @spences10/pi-mcp@0.0.9
  - @spences10/pi-lsp@0.0.8

## 0.1.21

### Patch Changes

- Updated dependencies [c7bed23]
- Updated dependencies [77e89a8]
  - @spences10/pi-team-mode@0.0.5

## 0.1.20

### Patch Changes

- c41b71a: Centralize project trust policy across MCP, LSP, hooks, and
  untrusted mode with shared package.
- bc797e2: Stop advertising `my-pi` as an installable Pi package;
  document CLI usage instead.
- Updated dependencies [c41b71a]
- Updated dependencies [4a48fcc]
  - @spences10/pi-project-trust@0.0.2
  - @spences10/pi-lsp@0.0.7
  - @spences10/pi-mcp@0.0.8
  - @spences10/pi-team-mode@0.0.4

## 0.1.19

### Patch Changes

- Updated dependencies [8076ac6]
  - @spences10/pi-child-env@0.1.1
  - @spences10/pi-team-mode@0.0.3
  - @spences10/pi-lsp@0.0.6
  - @spences10/pi-mcp@0.0.7

## 0.1.18

### Patch Changes

- 6a85bee: Add shared child-process environment helper and prevent
  team-mode teammates inheriting full parent env secrets.
- Updated dependencies [627f483]
- Updated dependencies [6a85bee]
  - @spences10/pi-confirm-destructive@0.0.5
  - @spences10/pi-sqlite-tools@0.0.3
  - @spences10/pi-omnisearch@0.0.3
  - @spences10/pi-team-mode@0.0.2
  - @spences10/pi-telemetry@0.0.3
  - @spences10/pi-nopeek@0.0.3
  - @spences10/pi-recall@0.0.3
  - @spences10/pi-redact@0.0.3
  - @spences10/pi-skills@0.0.4
  - @spences10/pi-lsp@0.0.5
  - @spences10/pi-mcp@0.0.6
  - @spences10/pi-child-env@0.1.0

## 0.1.17

### Patch Changes

- 30aad75: Add packaged team mode with RPC teammates, mailboxes,
  background orchestration, locking, and stale process detection.
- Updated dependencies [30aad75]
- Updated dependencies [16c677b]
  - @spences10/pi-mcp@0.0.5
  - @spences10/pi-team-mode@0.0.1

## 0.1.16

### Patch Changes

- 1660b22: Allow slash-containing Cloudflare Workers AI provider/model
  references and document required environment variables for my-pi
  usage.

## 0.1.15

### Patch Changes

- 5c37302: Align workspace Pi dependencies and group Renovate updates
  to prevent duplicate extension API types.
- Updated dependencies [5c37302]
  - @spences10/pi-confirm-destructive@0.0.4
  - @spences10/pi-sqlite-tools@0.0.2
  - @spences10/pi-omnisearch@0.0.2
  - @spences10/pi-telemetry@0.0.2
  - @spences10/pi-nopeek@0.0.2
  - @spences10/pi-recall@0.0.2
  - @spences10/pi-redact@0.0.2
  - @spences10/pi-skills@0.0.3
  - @spences10/pi-lsp@0.0.4
  - @spences10/pi-mcp@0.0.4

## 0.1.14

### Patch Changes

- 6dde715: Harden skill import paths and add Semgrep security scanning
  workflow badge.
- Updated dependencies [6dde715]
  - @spences10/pi-skills@0.0.2

## 0.1.13

### Patch Changes

- 61ff14d: Add untrusted repo safe mode for conservative project MCP,
  hooks, LSP, presets, skills, and child environment defaults.
- Updated dependencies [e84f2a4]
- Updated dependencies [07b0470]
  - @spences10/pi-mcp@0.0.3
  - @spences10/pi-confirm-destructive@0.0.3

## 0.1.12

### Patch Changes

- b29f211: Gate Claude-style hook execution behind trust prompts
  before running project-defined shell commands after tool use.
- cf0d023: Restrict child process environment passthrough for MCP,
  LSP, and hook command execution safely by default.
- Updated dependencies [edc9723]
- Updated dependencies [cf0d023]
- Updated dependencies [0a72284]
- Updated dependencies [4f16b43]
  - @spences10/pi-mcp@0.0.2
  - @spences10/pi-lsp@0.0.3

## 0.1.11

### Patch Changes

- Updated dependencies [381d549]
- Updated dependencies [0ef336d]
  - @spences10/pi-lsp@0.0.2

## 0.1.10

### Patch Changes

- 3ef8d39: Add Omnisearch and SQLite prompt shims; refine destructive
  confirmation for session-created files.
- Updated dependencies [3ef8d39]
  - @spences10/pi-confirm-destructive@0.0.2
  - @spences10/pi-sqlite-tools@0.0.1
  - @spences10/pi-omnisearch@0.0.1

## 0.1.9

### Patch Changes

- b8607ba: Add git-aware destructive action guard with session-level
  allow-similar prompts and database safety detection.
- 81b97c6: Remove fragile handoff extension and references in favor of
  Pi’s built-in session branching.
- d1b9fd8: Fix filtered root test runs so workspace package tests are
  not passed invalid filters.
- b29f667: Remove low-value working indicator extension and related
  CLI, manager, docs, and tests.
- f3efc44: Extract confirm destructive guard into reusable package
  consumed by my-pi as built-in extension.
- Updated dependencies [f3efc44]
  - @spences10/pi-confirm-destructive@0.0.1

## 0.1.8

### Patch Changes

- ada9a75: Split redaction and telemetry into installable Pi workspace
  packages with dedicated documentation and extension manifests.
- a6ff57b: Extract MCP, LSP, and skills into public installable Pi
  workspace packages.
- 148aa42: Add recall and nopeek prompt reminder packages with
  background recall sync on session lifecycle.
- 953f3bc: Add editable Markdown prompt presets, prompt-preset
  aliases, help examples, and improved CLI documentation.
- Updated dependencies [ada9a75]
- Updated dependencies [a6ff57b]
- Updated dependencies [148aa42]
  - @spences10/pi-telemetry@0.0.1
  - @spences10/pi-redact@0.0.1
  - @spences10/pi-skills@0.0.1
  - @spences10/pi-lsp@0.0.1
  - @spences10/pi-mcp@0.0.1
  - @spences10/pi-nopeek@0.0.1
  - @spences10/pi-recall@0.0.1

## 0.1.7

### Patch Changes

- e8bfb58: Report MCP startup failures through TUI notifications
  instead of stderr to preserve terminal usability.

## 0.1.6

### Patch Changes

- 2f86b9b: Default sessions to terse and propagate prompt presets into
  chain subagents for consistently concise responses.
- e222c57: Migrate TypeBox imports and update handoff new-session flow
  for Pi 0.70 compatibility.

## 0.1.5

### Patch Changes

- 997f7c2: Redact SSH config metadata in tool output to prevent host,
  user, proxy, and path leaks.

## 0.1.4

### Patch Changes

- b070e55: Clarify non-interactive behavior, nested runs, safer
  defaults, simpler CLI logic, and richer built-in help.
- a89180c: Improve non-interactive defaults, disable UI-only builtins
  headlessly, simplify CLI conditionals, and enrich help output.

## 0.1.3

### Patch Changes

- 378799b: Simplify working indicator options to useful modes only,
  removing distracting experimental custom indicator variants.
- 78f8067: Restore Pi’s default working spinner by default while
  keeping customizable indicator modes and footer alignment.

## 0.1.2

### Patch Changes

- b57516f: Adopt pi-coding-agent 0.68 prompt-awareness, MCP working
  indicators, cwd-safe loading, and richer shutdown telemetry
  metadata.
- 649f51a: Add configurable working indicator command and align prompt
  preset status with extension footer indicators.

## 0.1.1

### Patch Changes

- fa0b6ef: Add hooks-resolution extension for Claude-style PostToolUse
  hook execution from .claude, .rulesync, and .pi configs.
- a8d39d7: Improve /extensions DX by opening interactive toggle list
  when enable, disable, or toggle lack keys.
- ad647f5: Add confirm-destructive extension prompting before
  clearing, switching, or forking sessions, with configurable built-in
  extension toggles.

## 0.1.0

### Minor Changes

- f6fa050: Upgrade the built-in handoff extension to use AI-generated
  session transfer prompts.

  The `/handoff` command now:
  - summarizes the current branch conversation with the active model
  - asks the user to review and edit the generated prompt
  - creates a new session linked to the current one
  - prefills the editor in the new session with the handoff prompt

  This replaces the older file-based handoff export flow.

- d11c590: Add a built-in `session-name` extension for AI-powered
  session naming.
  - auto-generates a session name after the first completed turn when
    running interactively
  - adds `/session-name` to show, set, or auto-generate the current
    session name
  - adds `--no-session-name` to disable the extension

## 0.0.13

### Patch Changes

- f236fc0: Rename local telemetry extension from otel.ts to
  telemetry.ts and update README references accordingly.

## 0.0.12

### Patch Changes

- 53af638: Add Hetzner and broader secret redaction patterns, improve
  tests, and validate against synthetic eval harness.
- 783c8ea: Improve secret redaction for multiline keys, AWS secret
  formats, freeform logs, and isolated eval harness.

## 0.0.11

### Patch Changes

- d52e942: Add local SQLite telemetry, sandbox agent-dir overrides,
  richer docs, and improved package metadata for eval workflows.

## 0.0.10

### Patch Changes

- 144e018: Fix LSP startup cancellation race, prevent stale server
  reuse after restart, and add regression coverage.
- 257a1b4: Improve LSP reliability, add Svelte support,
  workspace-aware resolution, batched diagnostics, and symbol search
  tools.
- 25576b6: Improve startup responsiveness by skipping eager usage
  boot, backgrounding recall sync, and asynchronously initializing MCP
  connections.

## 0.0.9

### Patch Changes

- 1d08004: Add Pi-native LSP tools, status commands, local server
  resolution, document symbols, and comprehensive tests.

## 0.0.8

### Patch Changes

- 7cb74cb: Persist prompt presets across sessions and align footer
  prompt indicator beneath model using themed styling.
- ad8da43: Add HTTP MCP server support, validate transport config
  clearly, and close resolved CLI prompt issues.

## 0.0.7

### Patch Changes

- 33b0d81: Add CLI system prompt overrides, example preset config, and
  delete or reset support for custom presets.
- 3281a14: Add runtime prompt preset manager with base presets,
  additive layers, CLI selection, editing, and persistence.

## 0.0.6

### Patch Changes

- bf6e843: Bundle Pi themes and load them automatically in my-pi
  runtime, plus format theme and docs files.

## 0.0.5

### Patch Changes

- c2adc49: Fix CLI silent hangs: add --prompt flag, model validation,
  chain timeout and model passthrough

## 0.0.4

### Patch Changes

- dd3bd52: Add interactive /extensions manager with persisted built-in
  toggles and reload-safe extension loading.
- 929be39: import plugin skills into pi-native storage with syncable
  managed skill workflows
- febdae2: Unified skills UI: single scrollable list with section
  headers, checkbox batch-import for importable skills.

## 0.0.3

### Patch Changes

- 6588a83: Simplify recall extension to system prompt hint, model uses
  npx pirecall via bash directly

## 0.0.2

### Patch Changes

- 4a118a1: refactor: rename all local variables and functions from
  camelCase to snake_case
- bb1fc40: Parallelize MCP server connections for faster startup
- 13016ee: Refactor extensions to default exports loaded by path for
  named display in Pi CLI
- 128adf8: Add filter-output, handoff extensions, README docs, and 33
  tests
- 9f65d8b: feat: add --model/-m CLI flag to set initial model on
  startup
- fbed7e8: Add recall extension for searching past Pi sessions via
  pirecall SQLite database
- 89fb3df: Add composable skills extension: discover, enable/disable
  Claude Code plugin skills via skillsOverride
- 2265865: Add granular --no-mcp and --no-skills flags for
  per-extension control
- f229888: Add extension stacking, JSON output, stdin piping, and
  programmatic API
- 529fef8: Refactor MCP integration as pi extension with /mcp and
  /skills commands.
- 4247206: Add agent chain extension with sequential pipelines and
  system prompt injection

## 0.0.1

### Patch Changes

- a0d3ba7: Pi coding agent wrapper with MCP tool bridge and native
  auth support.
