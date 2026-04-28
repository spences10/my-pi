# @spences10/pi-lsp

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
