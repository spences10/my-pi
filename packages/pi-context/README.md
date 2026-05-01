# @spences10/pi-context

Local SQLite context sidecar for Pi. Oversized tool output is stored
in an FTS5-backed database and replaced with a compact receipt that
the agent can search or retrieve later.

## Local development

```bash
pnpm --filter @spences10/pi-context run build
pi install ./packages/pi-context
# or for one run only
pi -e ./packages/pi-context
```

## Commands/tools

- `context_search` — search indexed tool output
- `context_get` — retrieve exact stored chunks
- `context_stats` / `/context-stats` — byte accounting and DB stats
- `context_purge` — delete old indexed output

The default DB path is
`${PI_CODING_AGENT_DIR:-~/.pi/agent}/context.db`. Set
`MY_PI_CONTEXT_DB` to override it.

This is context retrieval/isolation, not a security sandbox. Stored
text is redacted with `@spences10/pi-redact` before persistence.
