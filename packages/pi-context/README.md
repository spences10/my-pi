# @spences10/pi-context

<!-- package-readme:header:start -->

[![built with Vite+](https://img.shields.io/badge/built%20with-Vite+-646CFF?logo=vite&logoColor=white)](https://viteplus.dev)
[![tested with Vitest](https://img.shields.io/badge/tested%20with-Vitest-6E9F18?logo=vitest&logoColor=white)](https://vitest.dev)
[![npm version](https://img.shields.io/npm/v/@spences10/pi-context?color=CB3837&logo=npm&logoColor=white)](https://www.npmjs.com/package/@spences10/pi-context)
[![license](https://img.shields.io/npm/l/@spences10/pi-context)](https://www.npmjs.com/package/@spences10/pi-context)

![my-pi package preview](https://raw.githubusercontent.com/spences10/my-pi/main/assets/pi-package-preview.png)

<!-- package-readme:header:end -->

Keep huge tool output useful without flooding the model context.
`pi-context` stores oversized command, file, MCP, and LSP results in a
local searchable SQLite sidecar, then gives the agent compact receipts
it can search or retrieve when needed.

The context tools use normal object-schema tool calling because their
optional filters are not portable across providers' strict-schema
rules.

In a SvelteKit docs extraction benchmark against the published
full-chunk retrieval flow, snippet-first search plus focused retrieval
and file export reduced total tokens by **68%**, cache-read tokens by
**70%**, and cost by **54%** while producing a comparable answer. See
[`docs/pi-context-benchmark.md`](https://github.com/spences10/my-pi/blob/main/docs/pi-context-benchmark.md)
for the scenario and raw comparison.

| Metric                      | Published | Current flow | Reduction |
| --------------------------- | --------: | -----------: | --------: |
| Tool calls                  |        49 |           27 |       45% |
| Context tool chars returned |   438,655 |      181,417 |       59% |
| Total tool chars returned   |   488,258 |      196,530 |       60% |
| Input tokens                |   163,626 |      116,844 |       29% |
| Cache-read tokens           | 2,943,488 |      884,224 |       70% |
| Total tokens                | 3,113,785 |    1,004,674 |       68% |
| Cost                        |     $2.49 |        $1.13 |       54% |

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
  project/session scope by default. Use it snippet-first before
  retrieving chunks. `full_content: true` returns full matched chunks
  and should be a last resort for small matches, not broad retrieval.
  Pass `global: true` to search all scopes.
- `context_get` — retrieve focused stored chunks by source id into the
  model context. Normally pass `source_id` plus `chunk_id`, then add
  `before` / `after` to include nearby surrounding chunks without
  retrieving the full source. Neighbor ranges are capped at 3 chunks
  each side; omitting `chunk_id` is exceptional full-source chat
  retrieval. Use `context_export` for broader inspection.
- `context_export` — write full or ranged stored chunks to a managed
  export file without returning chunk content to the model, useful
  before `jq`, Python, `sed`, `awk`, or `rg` processing. Omit
  `chunk_id` when you intentionally want full-source offline
  processing. Pass `file_path` to choose a destination.
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

## Programmatic API

The default export is the Pi extension. The root module also exposes
sidecar helpers used by sibling packages and custom harnesses:

- context settings helpers such as `get_context_mcp_output_limits()`
  and `load_context_settings_config()` for sharing retention and
  capture policy.
- store helpers such as `maybe_store_context_output()`,
  `get_context_store()`, and `set_context_sidecar_enabled()` for
  controlled direct indexing and tests.
- eval helpers `run_context_eval()` and `run_context_eval_cli()` for
  package evaluation workflows.

`@spences10/pi-mcp` uses these root exports to store oversized MCP
results in the sidecar before falling back to temporary files. The
`./store` subpath remains available for store-only consumers.

Receipts include the source id, first exact chunk id, why the output
was captured, and a low-context retrieval path:

```text
First chunk id: ctx_..._0001
context_search query:"..." source_id:"ctx_..."
context_get source_id:"ctx_..." chunk_id:"ctx_..._0001" before:1 after:1
context_export source_id:"ctx_..."
context_list
```

`context_get` accepts exact chunk ids plus ordinal aliases such as `1`
or `0001`, and legacy guessed references such as `ctx_...:chunk:000`.
Use `before` / `after` with `chunk_id` to include neighboring chunks
in one call. Neighbor ranges are capped at 3 chunks each side to avoid
accidentally recreating full-source retrieval. `context_export`
accepts the same source/chunk selectors and neighbor options. By
default it writes to
`${PI_CODING_AGENT_DIR:-~/.pi/agent}/context-exports/`, next to the
sidecar database, and cleans that managed export directory using the
same retention-days policy as the sidecar. Pass `file_path` to write
elsewhere; relative paths resolve from the current working directory.
The tool returns only export metadata.

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
project/session scope, retention, and dedupe rules. Duplicate outputs
reuse an existing source only when that source is visible to the same
default retrieval scope.

## Storage, scoping, and retention

The default DB path is
`${PI_CODING_AGENT_DIR:-~/.pi/agent}/context.db`. Set
`MY_PI_CONTEXT_DB` to override it.

Default `context_export` files are written next to that database under
`context-exports/`, for example
`${PI_CODING_AGENT_DIR:-~/.pi/agent}/context-exports/ctx_....txt`.
Older managed export files are pruned on export using the same
retention-days setting as the sidecar.

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

<!-- package-readme:development:start commands="check,test,build" -->

Package scripts build transitive workspace dependencies first, then
run local tools through Vite+ with `vp exec`.

```bash
pnpm --filter @spences10/pi-context run check
pnpm --filter @spences10/pi-context run test
pnpm --filter @spences10/pi-context run build
```

<!-- package-readme:development:end -->
