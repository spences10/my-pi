# @spences10/pi-telemetry

## 0.0.27

### Patch Changes

- Updated dependencies [7bdc98e]
  - @spences10/pi-settings@0.0.2

## 0.0.26

### Patch Changes

- 952589f: Add shared SQLite busy retry and transaction helpers across
  database-backed Pi packages.
- 85f7efb: Add shared SQLite helpers for busy handling and consistent
  pragmas across Pi database-backed packages.
- Updated dependencies [952589f]
- Updated dependencies [85f7efb]
  - @spences10/pi-sqlite-core@0.0.2

## 0.0.25

### Patch Changes

- Updated dependencies [f038302]
- Updated dependencies [7b6253e]
  - @spences10/pi-settings@0.0.1

## 0.0.24

### Patch Changes

- b282723: Update Pi 0.78.1 integration: refresh docs paths, lockfile,
  and TUI mode detection guards.

## 0.0.23

### Patch Changes

- 6386671: Add explicit Pi peer dependency to project trust package
  for clearer runtime expectations.

## 0.0.22

### Patch Changes

- 90b34d2: Centralize user settings across packages while preserving
  portable MCP server configuration in mcp.json.

## 0.0.21

### Patch Changes

- 96071d3: Add package preview image to package READMEs so npm pages
  display consistent project branding.
- Updated dependencies [96071d3]
  - @spences10/pi-tui-modal@0.0.20

## 0.0.20

### Patch Changes

- Updated dependencies [7d90676]
  - @spences10/pi-tui-modal@0.0.19

## 0.0.19

### Patch Changes

- 599b355: Improve package README openings and descriptions to
  emphasize user benefits and clarify pi-skills/pi-recall positioning.
- Updated dependencies [599b355]
  - @spences10/pi-tui-modal@0.0.18

## 0.0.18

### Patch Changes

- a040ea3: Standardize package scripts through Vite+ and refresh
  README badges/development guidance across published packages.
- Updated dependencies [a040ea3]
  - @spences10/pi-tui-modal@0.0.17

## 0.0.17

### Patch Changes

- ffea37e: Standardize shared dependency versions through pnpm catalog
  and align package dev dependencies for CI.
- Updated dependencies [ffea37e]
  - @spences10/pi-tui-modal@0.0.16

## 0.0.16

### Patch Changes

- Updated dependencies [600dbac]
  - @spences10/pi-tui-modal@0.0.15

## 0.0.15

### Patch Changes

- c28975d: Refactor telemetry extension into semantic modules for
  context helpers, UI, types, and store loading.
- Updated dependencies [2305de8]
- Updated dependencies [e58b031]
  - @spences10/pi-tui-modal@0.0.14

## 0.0.14

### Patch Changes

- bea8707: Add package-specific homepage links so Pi gallery pages
  point to each package README.
- 3e91b90: Add shared package gallery preview image to all Pi package
  manifests.

## 0.0.13

### Patch Changes

- 8944bf8: Move Pi core runtime packages to peer dependencies for
  safer external extension installs.
- Updated dependencies [8944bf8]
  - @spences10/pi-tui-modal@0.0.13

## 0.0.12

### Patch Changes

- Updated dependencies [c771d16]
  - @spences10/pi-tui-modal@0.0.12

## 0.0.11

### Patch Changes

- Updated dependencies [7fcd066]
  - @spences10/pi-tui-modal@0.0.11

## 0.0.10

### Patch Changes

- Updated dependencies [0f63525]
  - @spences10/pi-tui-modal@0.0.10

## 0.0.9

### Patch Changes

- dacf04d: Simplify skills TUI navigation, split importable skill
  actions, and clarify profile policy/rule wording.
- 44136fe: Migrate Pi core dependencies from Mario Zechner scope to
  Earendil Works package scope.
- Updated dependencies [dacf04d]
- Updated dependencies [44136fe]
  - @spences10/pi-tui-modal@0.0.9

## 0.0.8

### Patch Changes

- Updated dependencies [fd8a6ae]
  - @spences10/pi-tui-modal@0.0.8

## 0.0.7

### Patch Changes

- 9bbacf1: Improve pi-context chunk retrieval UX with first chunk
  receipts, aliases, and helpful miss messages.
- Updated dependencies [9bbacf1]
  - @spences10/pi-tui-modal@0.0.7

## 0.0.6

### Patch Changes

- Updated dependencies [7b27f9e]
  - @spences10/pi-tui-modal@0.0.6

## 0.0.5

### Patch Changes

- ca3d5e5: Harden redaction, document eval workflow, align Node
  support, and clarify SQLite warning policy across packages.
- 0495264: Split LSP, telemetry, MCP, and team store god files into
  focused modules with colocated tests.
- d8c5c5b: Replace hand-coded workspace dependency builds with pnpm
  graph-backed self tasks and script consistency tests.
- Updated dependencies [ca3d5e5]
- Updated dependencies [d8c5c5b]
  - @spences10/pi-tui-modal@0.0.5

## 0.0.4

### Patch Changes

- 52cfb66: Add modal-first navigation dashboards for LSP and telemetry
  commands using shared Pi TUI modal primitives.
- Updated dependencies [ee169f8]
  - @spences10/pi-tui-modal@0.0.4

## 0.0.3

### Patch Changes

- 627f483: Standardize package READMEs with npm badges, Vite+/Vitest
  messaging, installation, and development docs.

## 0.0.2

### Patch Changes

- 5c37302: Align workspace Pi dependencies and group Renovate updates
  to prevent duplicate extension API types.

## 0.0.1

### Patch Changes

- ada9a75: Split redaction and telemetry into installable Pi workspace
  packages with dedicated documentation and extension manifests.
- a6ff57b: Extract MCP, LSP, and skills into public installable Pi
  workspace packages.
- 148aa42: Add recall and nopeek prompt reminder packages with
  background recall sync on session lifecycle.
