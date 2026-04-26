# my-pi

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
