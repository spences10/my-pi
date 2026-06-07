# @spences10/pi-observability

[![built with Vite+](https://img.shields.io/badge/built%20with-Vite+-646CFF?logo=vite&logoColor=white)](https://viteplus.dev)
[![tested with Vitest](https://img.shields.io/badge/tested%20with-Vitest-6E9F18?logo=vitest&logoColor=white)](https://vitest.dev)
[![npm version](https://img.shields.io/npm/v/@spences10/pi-observability?color=CB3837&logo=npm&logoColor=white)](https://www.npmjs.com/package/@spences10/pi-observability)
[![license](https://img.shields.io/npm/l/@spences10/pi-observability)](https://www.npmjs.com/package/@spences10/pi-observability)

![my-pi package preview](https://raw.githubusercontent.com/spences10/my-pi/main/assets/pi-package-preview.png)

Live local observability for Pi sessions. When enabled, the extension
auto-starts a local server, streams redacted lifecycle events to it,
and serves browser single-session, swimlane, and race-style views over
Server-Sent Events.

## Installation

```bash
pi install npm:@spences10/pi-observability
```

Local development from this monorepo:

```bash
pnpm --filter @spences10/pi-observability run build
pi install ./packages/pi-observability
```

## Usage

For the `my-pi` distribution, observability is ambient: start Pi as
usual, then open the dashboard from the TUI with `/observability`.

```bash
pnpx my-pi@latest
```

You can also start/open the dashboard directly:

```bash
pnpx my-pi@latest observability
# or from this package binary
pnpx pi-observability-server
```

Defaults:

```text
http://127.0.0.1:43190
~/.pi/agent/observability.db
```

Server environment variables:

```bash
MY_PI_OBSERVABILITY_HOST=127.0.0.1
MY_PI_OBSERVABILITY_PORT=43190
MY_PI_OBSERVABILITY_DB=~/.pi/agent/observability.db
MY_PI_OBSERVABILITY_RETENTION_DAYS=14
MY_PI_OBSERVABILITY_MAX_EVENTS=100000
MY_PI_OBSERVABILITY_TOKEN=dev-token
```

Open `http://127.0.0.1:43190/?token=dev-token` when a token is set.
The dashboard includes:

- **Single** — detailed event payloads for one session.
- **Swimlane** — recent events for up to eight sessions side by side.
- **Race** — all loaded events sorted by timestamp for timing
  comparison.

## Advanced configuration

By default the extension uses `http://127.0.0.1:43190` and starts the
local server if needed. Set a URL only when sending events to a custom
or already-running server:

```bash
MY_PI_OBSERVABILITY_URL=http://127.0.0.1:43190 pi
```

With auth and grouping:

```bash
MY_PI_OBSERVABILITY_URL=http://127.0.0.1:43190 \
MY_PI_OBSERVABILITY_TOKEN=dev-token \
MY_PI_OBSERVABILITY_POOL=team-demo \
MY_PI_OBSERVABILITY_TAG=agent-a,experiment-1 \
pi
```

Equivalent Pi flags:

```text
--observability-url
--observability-token
--observability-pool
--observability-tag
--observability-name
--observability-raw
--observability-disable
--no-observability
```

## What it records

Events are stored as ordered envelopes with:

- session id, session file, cwd
- pool, tags, optional friendly agent name
- provider and model when available
- event type, timestamp, monotonic session sequence
- redacted payload summary

The extension listens for session, agent, turn, message, tool,
provider, model, compaction, and branch events when the installed Pi
version emits them. `/sessions` and `/events/stream` support `pool`,
`tag`, and `session_id` filters where relevant.

## Safety

By default payloads are summarized and recursively redacted before
they leave the process. Raw payload mode is opt-in with
`--observability-raw` or `MY_PI_OBSERVABILITY_RAW=true`; redaction and
a payload byte cap still apply.

This package does not read `.env` files automatically. Pass only the
configuration you want through environment variables or flags.

## Development

```bash
pnpm --filter @spences10/pi-observability run check
pnpm --filter @spences10/pi-observability run test
pnpm --filter @spences10/pi-observability run build
```

## License

MIT
