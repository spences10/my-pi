# my-pi

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
