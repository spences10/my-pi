# @spences10/pi-mcp

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
