# @spences10/pi-skills

## 0.0.22

### Patch Changes

- ffea37e: Standardize shared dependency versions through pnpm catalog
  and align package dev dependencies for CI.
- Updated dependencies [ffea37e]
  - @spences10/pi-tui-modal@0.0.16

## 0.0.21

### Patch Changes

- dcbb483: Improve skills onboarding by highlighting detected Claude
  Code skills and nudging first-time imports.
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

## 0.0.20

### Patch Changes

- 2305de8: Improve targeted test coverage for modal, Git UI, skills,
  recall, and nopeek behavior flows
- e58b031: Add missing per-file smoke tests across packages and enable
  full test runs for weakly covered modules
- 8aa7681: Refactor MCP, prompt presets, and skills modules into
  semantic files with focused tests.
- Updated dependencies [2305de8]
- Updated dependencies [e58b031]
  - @spences10/pi-tui-modal@0.0.14

## 0.0.19

### Patch Changes

- bea8707: Add package-specific homepage links so Pi gallery pages
  point to each package README.
- 3e91b90: Add shared package gallery preview image to all Pi package
  manifests.

## 0.0.18

### Patch Changes

- 8944bf8: Move Pi core runtime packages to peer dependencies for
  safer external extension installs.
- Updated dependencies [8944bf8]
  - @spences10/pi-tui-modal@0.0.13

## 0.0.17

### Patch Changes

- Updated dependencies [c771d16]
  - @spences10/pi-tui-modal@0.0.12

## 0.0.16

### Patch Changes

- d136588: Add responsive progress overlays for GitHub skill install,
  overwrite, update, and cancellable async gh operations.
- 7fcd066: Add reusable progress modal helper and use it for
  cancellable GitHub skill operations.
- Updated dependencies [7fcd066]
  - @spences10/pi-tui-modal@0.0.11

## 0.0.15

### Patch Changes

- ab0f974: Handle existing GitHub skills during install-all by letting
  users skip or overwrite installed entries safely.
- 8c99497: Add GitHub CLI skill import and update support to pi-skills
  commands, tests, and package docs.
- 44d0e3f: Add a GitHub skill install-all TUI path that discovers
  repository skills and installs each one.
- 21b3e03: Use GET for GitHub tree API requests when discovering
  repository skills during install-all menu flows.
- 1aa5a6e: Improve the skills menu with batch plugin imports, GitHub
  skill add/update actions, and toast-only refresh.
- a187251: Split the large skills UI module into focused files while
  preserving the existing public exports.
- Updated dependencies [0f63525]
  - @spences10/pi-tui-modal@0.0.10

## 0.0.14

### Patch Changes

- 23136b8: Add contextual project skill discovery and profile-based
  activation for .agents and repository-specific skills.
- dacf04d: Simplify skills TUI navigation, split importable skill
  actions, and clarify profile policy/rule wording.
- 44136fe: Migrate Pi core dependencies from Mario Zechner scope to
  Earendil Works package scope.
- Updated dependencies [dacf04d]
- Updated dependencies [44136fe]
  - @spences10/pi-tui-modal@0.0.9

## 0.0.13

### Patch Changes

- Updated dependencies [fd8a6ae]
  - @spences10/pi-tui-modal@0.0.8

## 0.0.12

### Patch Changes

- 9bbacf1: Improve pi-context chunk retrieval UX with first chunk
  receipts, aliases, and helpful miss messages.
- Updated dependencies [9bbacf1]
  - @spences10/pi-tui-modal@0.0.7

## 0.0.11

### Patch Changes

- Updated dependencies [7b27f9e]
  - @spences10/pi-tui-modal@0.0.6

## 0.0.10

### Patch Changes

- 132eff7: Refactor skill profiles into named skill sets with
  profile-based enablement and legacy config migration.

## 0.0.9

### Patch Changes

- 61a17ba: Refactor skills management UI into focused modules and add
  generic profile support with tests.
- ca3d5e5: Harden redaction, document eval workflow, align Node
  support, and clarify SQLite warning policy across packages.
- d8c5c5b: Replace hand-coded workspace dependency builds with pnpm
  graph-backed self tasks and script consistency tests.
- Updated dependencies [ca3d5e5]
- Updated dependencies [d8c5c5b]
  - @spences10/pi-tui-modal@0.0.5

## 0.0.8

### Patch Changes

- 57d754f: Add package smoke tests, MCP failure coverage, warning
  filtering, and agent-dir isolation documentation updates
- 15cbd0a: Fix agent-dir isolation leaks and scope runtime environment
  mutations to disposed my-pi sessions safely

## 0.0.7

### Patch Changes

- e711bd0: Add a modal home menu for skills management, imports,
  syncs, refresh summaries, and default policy selection.
- d425461: Add modal skill browsing with read-only detail views while
  preserving script-friendly list and show commands.
- Updated dependencies [ee169f8]
  - @spences10/pi-tui-modal@0.0.4

## 0.0.6

### Patch Changes

- Updated dependencies [bb2c70e]
  - @spences10/pi-tui-modal@0.0.3

## 0.0.5

### Patch Changes

- f6871b6: Show inline skill descriptions in modal rows while
  preserving selected item metadata details panel.
- c4356b9: Cap visible skill modal rows so selected item metadata
  remains visible below large lists.
- ab5ee75: Add shared padded TUI modals and replace bracket status
  labels with clearer terminal glyphs.
- Updated dependencies [f6871b6]
  - @spences10/pi-tui-modal@0.0.2

## 0.0.4

### Patch Changes

- 627f483: Standardize package READMEs with npm badges, Vite+/Vitest
  messaging, installation, and development docs.

## 0.0.3

### Patch Changes

- 5c37302: Align workspace Pi dependencies and group Renovate updates
  to prevent duplicate extension API types.

## 0.0.2

### Patch Changes

- 6dde715: Harden skill import paths and add Semgrep security scanning
  workflow badge.

## 0.0.1

### Patch Changes

- a6ff57b: Extract MCP, LSP, and skills into public installable Pi
  workspace packages.
- 148aa42: Add recall and nopeek prompt reminder packages with
  background recall sync on session lifecycle.
