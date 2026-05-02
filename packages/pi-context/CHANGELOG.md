# @spences10/pi-context

## 0.0.4

### Patch Changes

- 1745de7: Refactor pi-context store into focused schema, policy,
  text, and type modules without behavior changes.
- aa8cfb7: Improve extension UX with context modal, MCP profile
  picker, clearer redaction naming, and team cleanup.
- f4203a0: Document context sidecar coverage policy and prevent
  recursive indexing of context and MCP receipts.
- 63438fd: Extract pi-context SQLite schema into packaged SQL file
  with migration versioning and build/test coverage.
- c7d0025: Add context sidecar retention policy, lifecycle cleanup,
  purge filters, and stats reporting.
- fd9a2b2: Add scoped context source listing tool and command with
  filters, pagination, and metadata previews.
- 03e02a8: Deduplicate same-scope context sources and improve purge
  details with project and session filter support.
- 35d85b9: Improve context receipts, scoped stats, previews, and
  documentation for clearer sidecar retrieval UX.
- 2fa5ae5: Scope context sidecar storage and retrieval to current
  project/session with explicit global lookup.

## 0.0.3

### Patch Changes

- ca3d5e5: Harden redaction, document eval workflow, align Node
  support, and clarify SQLite warning policy across packages.
- d8c5c5b: Replace hand-coded workspace dependency builds with pnpm
  graph-backed self tasks and script consistency tests.
- Updated dependencies [ca3d5e5]
- Updated dependencies [f3c5600]
- Updated dependencies [d8c5c5b]
  - @spences10/pi-redact@0.0.4

## 0.0.2

### Patch Changes

- 2552f1f: Add comprehensive context sidecar eval tests, improve line
  chunking
