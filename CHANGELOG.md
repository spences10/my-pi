# my-pi

## 0.0.2

### Patch Changes

- 4a118a1: refactor: rename all local variables and functions from camelCase to
  snake_case
- bb1fc40: Parallelize MCP server connections for faster startup
- 13016ee: Refactor extensions to default exports loaded by path for named display in Pi CLI
- 128adf8: Add filter-output, handoff extensions, README docs, and 33 tests
- 9f65d8b: feat: add --model/-m CLI flag to set initial model on startup
- fbed7e8: Add recall extension for searching past Pi sessions via pirecall
  SQLite database
- 89fb3df: Add composable skills extension: discover, enable/disable Claude Code
  plugin skills via skillsOverride
- 2265865: Add granular --no-mcp and --no-skills flags for per-extension control
- f229888: Add extension stacking, JSON output, stdin piping, and programmatic
  API
- 529fef8: Refactor MCP integration as pi extension with /mcp and /skills
  commands.
- 4247206: Add agent chain extension with sequential pipelines and system prompt
  injection

## 0.0.1

### Patch Changes

- a0d3ba7: Pi coding agent wrapper with MCP tool bridge and native
  auth support.
