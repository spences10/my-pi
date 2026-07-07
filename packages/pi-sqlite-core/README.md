# @spences10/pi-sqlite-core

Shared SQLite helpers for Pi packages.

## Exports

- `SQLITE_PERSISTENT_PRAGMAS` — durable database pragmas such as WAL.
- `SQLITE_CONNECTION_PRAGMAS` — per-connection pragmas such as
  `busy_timeout`.
- `sqlite_pragmas()` — builds pragma SQL with optional `foreign_keys`
  and timeout settings.
- `is_sqlite_busy(error)` — detects SQLite busy/locked errors.
- `safe_sqlite_tick(fn)` — runs background SQLite work and suppresses
  transient busy errors.
- `with_sqlite_busy_retry(fn, options)` — retries sync SQLite work on
  busy errors.
