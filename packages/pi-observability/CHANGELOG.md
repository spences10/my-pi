# @spences10/pi-observability

## 0.0.17

### Patch Changes

- cabc024: Improve observability dashboard usefulness with accurate
  metrics, session names, tool insights, and modern responsive layout.
- Updated dependencies [6421930]
  - @spences10/pi-tui-modal@0.0.21

## 0.0.16

### Patch Changes

- 7bdc98e: Deduplicate shared input string extraction, simplify
  observability internals, and centralize pi-context test helpers.

## 0.0.15

### Patch Changes

- 952589f: Add shared SQLite busy retry and transaction helpers across
  database-backed Pi packages.
- 85f7efb: Add shared SQLite helpers for busy handling and consistent
  pragmas across Pi database-backed packages.
- Updated dependencies [952589f]
- Updated dependencies [85f7efb]
  - @spences10/pi-sqlite-core@0.0.2

## 0.0.14

### Patch Changes

- 6ef5062: Simplify Pi observability dashboard, remove cluttered
  views, and harden local server request handling and startup.

## 0.0.13

### Patch Changes

- 1c8e66c: Enhance observability dashboard session context, event
  drawer details, payload summaries, and live update persistence.

## 0.0.12

### Patch Changes

- 629f238: Refactor context, observability, and API modules into
  focused files, eliminating architecture boundary advisories.

## 0.0.11

### Patch Changes

- bb2ef4a: Add Svelte web tsconfig and exclude generated Cloudflare
  worker types from formatting checks.

## 0.0.10

### Patch Changes

- 20e0ddc: Improve observability dashboard light theme contrast,
  readability, borders, and pastel surface color balance.
- ba3cfe8: Refine observability dashboard dark theme colors to better
  match terminal-inspired Neon Afterglow visual style.

## 0.0.9

### Patch Changes

- 1c1d147: Make observability session list scroll responsively without
  collapsing expanded repository session groups.
- 5ea3434: Fix observability dashboard fonts and align dark/light
  theme colors with Neon Afterglow palette.
- d933017: Normalize observability typography tokens and match event
  drawer JSON sizing to main event rows.
- 9eb8790: Make observability main content keep session controls fixed
  while selected view scrolls independently.

## 0.0.8

### Patch Changes

- 5375c4c: Make web observability dashboard default and keep terminal
  dashboard available via observability tui subcommand.
- e16746a: Restore observability token and cost metrics using session
  files and shared number formatting.

## 0.0.7

### Patch Changes

- 7c9146d: Rebuild pi-observability dashboard as Svelte SPA with trace
  bottlenecks, summaries, and static asset serving.
- 671a01f: Restructure observability dashboard around session
  timelines, improve event drawer interactions, formatting, and
  responsive overflow handling.
- 7d94d4f: Refactor observability web dashboard into focused Svelte
  view components with scoped styling and shared analysis helpers.
- 699fce5: Add themed Svelte observability views for swimlane, race,
  labels, filters, artifacts, and live caching.
- ffda1fb: Refactor dashboard state into runes module, extract
  kebab-case components, and reorganize trace cards.
- 4e9d08c: Improve observability sidebar session management with
  toggle filters, active indicators, hover actions, and recency-aware
  grouping.

## 0.0.6

### Patch Changes

- 747bcd3: Add TUI observability dashboard with drilldown, filtering,
  scrollable JSON payloads, and browser performance fixes.

## 0.0.5

### Patch Changes

- 9f2c56a: Fix observability dashboard chip overlap with structured
  rows, truncation, and line-clamp compatibility CSS.

## 0.0.4

### Patch Changes

- a6e4bed: Fix observability dashboard group chips wrapping and
  truncation to prevent overlap with long project paths.

## 0.0.3

### Patch Changes

- 9538d34: Improve observability dashboard with project grouping,
  trace inspection, searchable events, summaries, and better dev
  reload UX.
- 6f2fa2e: Add observability trace analytics with usage rollups,
  provider status, artifacts, labels, and backend event search.
- a0d5742: Improve observability dashboard theming, typography, active
  session indicators, layout density, overflow handling, and trace
  insights UX.

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
