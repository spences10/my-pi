# @spences10/pi-telemetry

[![npm version](https://img.shields.io/npm/v/@spences10/pi-telemetry?color=CB3837&logo=npm)](https://www.npmjs.com/package/@spences10/pi-telemetry)
[![built with Vite+](https://img.shields.io/badge/built%20with-Vite+-646CFF?logo=vite&logoColor=white)](https://viteplus.dev)
[![tested with Vitest](https://img.shields.io/badge/tested%20with-Vitest-6E9F18?logo=vitest&logoColor=white)](https://vitest.dev)

Pi extension for local SQLite telemetry of runs, turns, tool calls,
and provider requests.

Maintained in the `my-pi` Vite+ workspace and tested with Vitest.

## Installation

```bash
pi install npm:@spences10/pi-telemetry
```

## Runtime

Requires Node.js `>=24.15.0` for native `node:sqlite`. The `my-pi` CLI
suppresses Node's expected `node:sqlite` `ExperimentalWarning`;
standalone package consumers own their process warning policy until
Node marks `node:sqlite` stable.

Local development from this monorepo:

```bash
pnpm --filter @spences10/pi-telemetry run build
pi install ./packages/pi-telemetry
# or for one run only
pi -e ./packages/pi-telemetry
```

## What it records

When enabled, the extension writes local telemetry to SQLite:

- `runs` — one record per Pi session/run
- `turns` — user/assistant turn timing and summaries
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

`my-pi` imports this package directly and wires it to the
`--telemetry`, `--no-telemetry`, and `--telemetry-db` CLI flags.

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

```bash
pnpm --filter @spences10/pi-telemetry run check
pnpm --filter @spences10/pi-telemetry run test
pnpm --filter @spences10/pi-telemetry run build
```

## License

MIT
