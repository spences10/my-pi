# @spences10/pi-context

[![built with Vite+](https://img.shields.io/badge/built%20with-Vite+-646CFF?logo=vite&logoColor=white)](https://viteplus.dev)
[![tested with Vitest](https://img.shields.io/badge/tested%20with-Vitest-6E9F18?logo=vitest&logoColor=white)](https://vitest.dev)
[![npm version](https://img.shields.io/npm/v/@spences10/pi-context?color=CB3837&logo=npm&logoColor=white)](https://www.npmjs.com/package/@spences10/pi-context)
[![license](https://img.shields.io/npm/l/@spences10/pi-context)](https://www.npmjs.com/package/@spences10/pi-context)

![my-pi package preview](https://raw.githubusercontent.com/spences10/my-pi/main/assets/pi-package-preview.png)

Keep huge tool output useful without flooding the model context.
`pi-context` stores oversized command, file, MCP, and LSP results in a
local searchable SQLite sidecar, then gives the agent compact receipts
it can search or retrieve when needed.

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
- `/context settings` — choose retention/size presets or inspect the
  effective saved/env-backed policy.

Use `/context` in interactive mode for a small modal with list, stats,
settings, and purge actions.

Receipts include the source id, first exact chunk id, and the main
retrieval path:

```text
First chunk id: ctx_..._0001
context_search query:"..." source_id:"ctx_..."
context_get source_id:"ctx_..."
context_list
```

`context_get` accepts exact chunk ids plus ordinal aliases such as `1`
or `0001`, and legacy guessed references such as `ctx_...:chunk:000`.

## Coverage policy

Intentional sidecar-backed output:

- `read` and `bash` text output: handled by the generic `tool_result`
  hook when output exceeds byte/line thresholds.
- MCP tool output: handled directly in `@spences10/pi-mcp` before
  temp-file fallback, then ignored by the generic hook because
  receipts already contain `[context-sidecar]`.
- LSP tool output: handled by the generic hook for large text
  diagnostics or symbol/reference dumps; small structured summaries
  stay inline.
- Hook output and telemetry summaries: not directly indexed unless
  they appear as large text tool results.

Intentionally skipped output:

- `context_*` tools: avoids recursive indexing of
  retrieval/maintenance output.
- `team`: coordination/mailbox/task state belongs in team-mode and
  session history surfaces, not this overflow cache.
- Non-text/image results: ignored by `pi-context`; image/file handling
  should use dedicated tool-specific surfaces.

Any newly sidecar-backed text follows the same redaction,
project/session scope, retention, and dedupe rules.

## Storage, scoping, and retention

The default DB path is
`${PI_CODING_AGENT_DIR:-~/.pi/agent}/context.db`. Set
`MY_PI_CONTEXT_DB` to override it.

New sources are scoped by Pi session file/id when available, falling
back to the current project path. Retrieval tools use that scope by
default to avoid leaking other projects or sessions into results; pass
`global: true` when you intend to search or list everything.

Retention, storage cap, and capture thresholds are saved at
`~/.config/my-pi/context.json` via `/context settings`. Presets
include `default`, `light`, `balanced`, `research`, and `archive`;
custom values are available with:

```text
/context settings custom <days|off> <max-mb|off> [capture-kb] [capture-lines] [purge-on-shutdown]
```

Capture thresholds control when large tool output is moved into the
sidecar instead of staying inline in the model context. Defaults match
historical behavior: generic tools capture after `24 KiB` or `300`
lines; MCP output captures after `50 KiB` or `2000` lines.

Environment variables override saved settings:

- `MY_PI_CONTEXT_RETENTION_DAYS` — default `7`; set `0`, `off`, or
  `disabled` to disable age cleanup.
- `MY_PI_CONTEXT_PURGE_ON_SHUTDOWN` — set `true`/`1`/`yes`/`on` to run
  cleanup on shutdown.
- `MY_PI_CONTEXT_MAX_MB` — optional max stored raw bytes; oldest
  sources are removed first when exceeded.
- `MY_PI_CONTEXT_CAPTURE_MAX_KB` / `MY_PI_CONTEXT_CAPTURE_MAX_LINES` —
  generic tool-output capture threshold.
- `MY_PI_CONTEXT_MCP_MAX_KB` / `MY_PI_CONTEXT_MCP_MAX_LINES` — MCP
  output capture threshold.
- `MY_PI_CONTEXT_CONFIG` — override the saved settings file path.

## Safety model

This is redacted local persistence and retrieval, not a security
sandbox. Stored text is redacted with `@spences10/pi-redact` before
persistence, but anything persisted in the local SQLite DB should
still be treated as local tool output.

## Development

Package scripts build transitive workspace dependencies first, then
run local tools through Vite+ with `vp exec`.

```bash
pnpm --filter @spences10/pi-context run check
pnpm --filter @spences10/pi-context run test
pnpm --filter @spences10/pi-context run build
```
