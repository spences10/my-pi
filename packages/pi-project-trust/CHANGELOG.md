# @spences10/pi-project-trust

## 0.0.19

### Patch Changes

- f74108d: Delegate project trust path resolution to shared settings
  while documenting upstream project-local configuration ownership
  boundaries.
- Updated dependencies [f74108d]
  - @spences10/pi-settings@0.0.3

## 0.0.18

### Patch Changes

- ba76fe9: Share generic project trust wrappers while preserving MCP,
  LSP, and hooks legacy trust migration behavior.

## 0.0.17

### Patch Changes

- c425095: Generate shared README maintenance blocks deterministically
  and validate package documentation links without removing
  package-specific guidance.

## 0.0.16

### Patch Changes

- acf4521: Remove unused Pi SDK peer dependency from project trust
  package and clean stale TypeBox dependency.

## 0.0.15

### Patch Changes

- Updated dependencies [7bdc98e]
  - @spences10/pi-settings@0.0.2

## 0.0.14

### Patch Changes

- Updated dependencies [f038302]
- Updated dependencies [7b6253e]
  - @spences10/pi-settings@0.0.1

## 0.0.13

### Patch Changes

- b282723: Update Pi 0.78.1 integration: refresh docs paths, lockfile,
  and TUI mode detection guards.

## 0.0.12

### Patch Changes

- 6386671: Add explicit Pi peer dependency to project trust package
  for clearer runtime expectations.

## 0.0.11

### Patch Changes

- 90b34d2: Centralize user settings across packages while preserving
  portable MCP server configuration in mcp.json.

## 0.0.10

### Patch Changes

- 96071d3: Add package preview image to package READMEs so npm pages
  display consistent project branding.

## 0.0.9

### Patch Changes

- 599b355: Improve package README openings and descriptions to
  emphasize user benefits and clarify pi-skills/pi-recall positioning.

## 0.0.8

### Patch Changes

- a040ea3: Standardize package scripts through Vite+ and refresh
  README badges/development guidance across published packages.

## 0.0.7

### Patch Changes

- ffea37e: Standardize shared dependency versions through pnpm catalog
  and align package dev dependencies for CI.

## 0.0.6

### Patch Changes

- dacf04d: Simplify skills TUI navigation, split importable skill
  actions, and clarify profile policy/rule wording.

## 0.0.5

### Patch Changes

- ca3d5e5: Harden redaction, document eval workflow, align Node
  support, and clarify SQLite warning policy across packages.
- d8c5c5b: Replace hand-coded workspace dependency builds with pnpm
  graph-backed self tasks and script consistency tests.

## 0.0.4

### Patch Changes

- 15cbd0a: Fix agent-dir isolation leaks and scope runtime environment
  mutations to disposed my-pi sessions safely

## 0.0.3

### Patch Changes

- 34d64ec: Add reusable teammate profiles with model, prompt, tool,
  skill limits, and project trust controls.

## 0.0.2

### Patch Changes

- c41b71a: Centralize project trust policy across MCP, LSP, hooks, and
  untrusted mode with shared package.
