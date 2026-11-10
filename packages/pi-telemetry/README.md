# @spences10/pi-telemetry

<!-- package-readme:header:start -->

[![built with Vite+](https://img.shields.io/badge/built%20with-Vite+-646CFF?logo=vite&logoColor=white)](https://viteplus.dev)
[![tested with Vitest](https://img.shields.io/badge/tested%20with-Vitest-6E9F18?logo=vitest&logoColor=white)](https://vitest.dev)
[![npm version](https://img.shields.io/npm/v/@spences10/pi-telemetry?color=CB3837&logo=npm&logoColor=white)](https://www.npmjs.com/package/@spences10/pi-telemetry)
[![license](https://img.shields.io/npm/l/@spences10/pi-telemetry)](https://www.npmjs.com/package/@spences10/pi-telemetry)

![my-pi package preview](https://raw.githubusercontent.com/spences10/my-pi/main/assets/pi-package-preview.png)

<!-- package-readme:header:end -->

Understand what your Pi sessions actually do. `pi-telemetry` records
local SQLite metrics for runs, turns, tool calls, and provider
requests so you can inspect usage, latency, cost, and agent behavior
over time.

Pi itself owns canonical per-session token and cost accounting,
including nested tool calls, compaction, and branch summaries.
`pi-telemetry` does not replace or independently reconstruct those
totals: it adds durable cross-run history, tool/provider latency,
outcomes, eval correlation, filtering, and exports. Use `pi-footer`
for current-session totals and `pi-observability` for live traces and
dashboard rollups.

## Installation

<!-- package-readme:install:start -->

```bash
pi install npm:@spences10/pi-telemetry
```

<!-- package-readme:install:end -->

## Runtime

Requires Node.js `>=24.15.0` for native `node:sqlite`. The `pi` and
`my-pi` CLIs suppress Node's expected `node:sqlite`
`ExperimentalWarning`; standalone package consumers own their process
warning policy until Node marks `node:sqlite` stable.

Local development from this monorepo:

```bash
pnpm --filter @spences10/pi-telemetry run build
pi install ./packages/pi-telemetry
# or for one run only
pi -e ./packages/pi-telemetry
```

## What it records

When enabled, the extension writes local telemetry to SQLite:

- `runs` — one record per low-level Pi agent run, or a tool-controlled
  recording window within that run
- `turns` — model response and tool execution timing and summaries
- `tool_calls` — tool name, timing, success/error, and result summary
- `provider_requests` — provider request/response timing and status

The default database path is:

```text
~/.pi/agent/telemetry.db
```

The saved enabled/disabled preference is stored at:

```text
~/.pi/agent/telemetry.json
```

## Enabling telemetry

Telemetry is disabled by default.

In an interactive Pi session:

```text
/telemetry on
```

Disable it again with:

```text
/telemetry off
```

Those commands persist the default for future sessions. A custom
harness can also pass process-level overrides through
`create_telemetry_extension()`.

## Commands

```text
/telemetry status
/telemetry stats
/telemetry query run=<run-id> success=true limit=10
/telemetry export ./telemetry-runs.json suite=smoke
/telemetry on
/telemetry off
/telemetry path
```

### `/telemetry status`

Shows whether telemetry is enabled, whether the current process is
using an override, and which database path is active.

### `/telemetry stats`

Shows aggregate counts and timing data from the local telemetry
database.

### `/telemetry query`

Lists recent run summaries. Supported filters:

- `run=` or `eval_run_id=`
- `case=` or `eval_case_id=`
- `suite=` or `eval_suite=`
- `success=true|false|null`
- `limit=<n>`

### `/telemetry export`

Exports matching run summaries as JSON. If no path is provided, the
extension creates a timestamped file in the current working directory.

## Agent tool

The extension registers a `telemetry` tool so the model can record and
read telemetry without the user typing a slash command.

| Action   | Behaviour                                                            |
| -------- | -------------------------------------------------------------------- |
| `status` | Shows the saved default, the current state and the database path.    |
| `on`     | Starts a session-only recording window, optionally labelled by task. |
| `off`    | Requests a stop at Pi's `turn_end`, only for tool-enabled recording. |
| `query`  | Returns recent run summaries as JSON.                                |

`on` and `off` never change the saved default; only `/telemetry on`
and `/telemetry off` do. The tool cannot turn off telemetry the user
enabled, and it does not override `--telemetry` or `--no-telemetry`.

`on` accepts `eval_suite` and `eval_case_id` to label a new recording
using the existing eval fields. For repeatable skills, use
`eval_suite: "repeatable-task"` and the skill name as `eval_case_id`.
It returns the run ID and session path. If recording is already on, it
does not start a new window or relabel existing work.

`off` leaves recording open until the native `turn_end` event, after
all tool results in that turn are recorded. Query in a subsequent
turn, not the same tool batch or codemode script. A normal window stop
has a closed duration and no error, but `success` remains unknown:
stopping recording does not prove task success. Aborted settlement
also restores tool-enabled recording to off.

Ordinary runs still finish on `agent_end`, which is not Pi's final
idle boundary: retries or queued messages can create further runs.
Task labels remain in effect until tool recording stops. Recording
starts at opt-in; it does not reconstruct earlier requests or tools.

`query` accepts `cwd`, `eval_suite`, `eval_case_id`, `success` and
`limit` (default 20). Each run includes its session file, working
directory, duration, and turn, tool-call and tool-error counts. The
response also identifies this session's `active_run_id` and whether a
stop is pending. Records with null `ended_at` and duration are
unfinished, not completed baselines. Compare matching tasks and
recording boundaries, not all activity in the same project; use
harness validation and session evidence to assess task success.

## Eval metadata

For eval harnesses, set these environment variables to correlate runs:

```bash
MY_PI_EVAL_RUN_ID=run-123
MY_PI_EVAL_CASE_ID=case-abc
MY_PI_EVAL_ATTEMPT=1
MY_PI_EVAL_SUITE=smoke
```

## Using from a custom harness

```ts
import { create_telemetry_extension } from '@spences10/pi-telemetry';

const telemetry = create_telemetry_extension({
	enabled: true,
	db_path: './tmp/evals.db',
	cwd: process.cwd(),
});

// pass `telemetry` as an ExtensionFactory to your Pi runtime
```

## SQLite schema

The schema source is `src/schema.sql` in this package. The current
schema version is tracked with `PRAGMA user_version`.

Operational details:

- unversioned databases are initialized/upgraded to schema version 1
- newer unsupported schema versions fail fast
- WAL mode is enabled with `PRAGMA journal_mode = WAL`
- lock contention waits up to 5 seconds with
  `PRAGMA busy_timeout = 5000`

## Development

<!-- package-readme:development:start commands="check,test,build" -->

Package scripts build transitive workspace dependencies first, then
run local tools through Vite+ with `vp exec`.

```bash
pnpm --filter @spences10/pi-telemetry run check
pnpm --filter @spences10/pi-telemetry run test
pnpm --filter @spences10/pi-telemetry run build
```

<!-- package-readme:development:end -->

## License

MIT
