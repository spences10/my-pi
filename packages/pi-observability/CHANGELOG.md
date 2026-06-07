# @spences10/pi-observability

## 0.0.2

### Patch Changes

- 879ffd0: Fix observability resume tracking with durable server-side
  sequencing and module-loaded dashboard JavaScript assets.
- 3473049: Improve observability dashboard layout, split assets, and
  compile dashboard script from TypeScript source.
- a198a5e: Extract observability dashboard HTML and SQLite schema
  assets for cleaner maintenance and packaged builds.
- f8f847b: Harden observability server ingest, validate configuration,
  and add retention limits for local event storage.

## 0.0.1

### Patch Changes

- 320fd33: Add ambient local observability with auto-started dashboard
  server and TUI command for live session inspection.
