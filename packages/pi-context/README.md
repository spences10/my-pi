# @spences10/pi-context

Local SQLite context sidecar for Pi. Oversized text tool output is
redacted, stored in an FTS5-backed database, and replaced with a
compact receipt that shows the source id, project/session scope, and
retrieval actions.

This is an ephemeral overflow cache for large artifacts, not durable
session memory. Use `pirecall` for durable session history.

## Runtime

Requires Node.js `>=24.15.0` for native `node:sqlite` plus FTS5. The
`my-pi` CLI suppresses Node's expected `node:sqlite`
`ExperimentalWarning`; standalone package consumers own their process
warning policy until Node marks `node:sqlite` stable.

## Local development

```bash
pnpm --filter @spences10/pi-context run build
pi install ./packages/pi-context
# or for one run only
pi -e ./packages/pi-context
```

## Commands/tools

- `context_search` — search indexed tool output in the current
  project/session scope by default. Pass `global: true` to search all
  scopes.
- `context_get` — retrieve exact stored chunks by source id.
- `context_list` / `/context list [limit]` — list recent indexed
  sources in the current scope with source ids, tool names, sizes, and
  previews.
- `context_stats` / `/context stats` / `/context-stats` — scoped
  totals, global totals, DB size, oldest/newest sources, and active
  retention policy.
- `context_purge` / `/context purge [days]` — delete old indexed
  output. Also supports source/project/session filters and
  `/context purge expired`.

Use `/context` in interactive mode for a small modal with list, stats,
and purge actions.

Receipts suggest the main retrieval path:

```text
context_search query:"..." source_id:"ctx_..."
context_get source_id:"ctx_..."
context_list
```

## Storage, scoping, and retention

The default DB path is
`${PI_CODING_AGENT_DIR:-~/.pi/agent}/context.db`. Set
`MY_PI_CONTEXT_DB` to override it.

New sources are scoped by Pi session file/id when available, falling
back to the current project path. Retrieval tools use that scope by
default to avoid leaking other projects or sessions into results; pass
`global: true` when you intend to search or list everything.

Retention is env-backed:

- `MY_PI_CONTEXT_RETENTION_DAYS` — default `7`; set `0`, `off`, or
  `disabled` to disable age cleanup.
- `MY_PI_CONTEXT_PURGE_ON_SHUTDOWN` — set `true`/`1`/`yes`/`on` to run
  cleanup on shutdown.
- `MY_PI_CONTEXT_MAX_MB` — optional max stored raw bytes; oldest
  sources are removed first when exceeded.

## Safety model

This is redacted local persistence and retrieval, not a security
sandbox. Stored text is redacted with `@spences10/pi-redact` before
persistence, but anything persisted in the local SQLite DB should
still be treated as local tool output.
