# @spences10/pi-team-mode

[![built with Vite+](https://img.shields.io/badge/built%20with-Vite+-646CFF?logo=vite&logoColor=white)](https://viteplus.dev)
[![tested with Vitest](https://img.shields.io/badge/tested%20with-Vitest-6E9F18?logo=vitest&logoColor=white)](https://vitest.dev)
[![npm version](https://img.shields.io/npm/v/@spences10/pi-team-mode?color=CB3837&logo=npm&logoColor=white)](https://www.npmjs.com/package/@spences10/pi-team-mode)
[![license](https://img.shields.io/npm/l/@spences10/pi-team-mode)](https://www.npmjs.com/package/@spences10/pi-team-mode)

![my-pi package preview](https://raw.githubusercontent.com/spences10/my-pi/main/assets/pi-package-preview.png)

Local peer-session coordination for Pi. `pi-team-mode` registers Pi
sessions in a local SQLite coordination bus, sends mailbox-backed peer
messages, stores larger handoff artifacts, and coordinates groups of
independently started sessions.

## Installation

```bash
pi install npm:@spences10/pi-team-mode
```

Local development from this monorepo:

```bash
pnpm --filter @spences10/pi-team-mode run build
pi install ./packages/pi-team-mode
# or for one run only
pi -e ./packages/pi-team-mode
```

## What it does

- registers every running session in a global local coordination bus
- discovers live sessions across projects and working directories
- marks stale PID-backed session registrations offline before listing
  or targeting peers
- sends compact mailbox-backed peer messages between independently
  started sessions
- opens headless, resumable teammate sessions that still behave as
  normal Pi sessions coordinated through mailboxes
- stores larger handoffs, plans, findings, logs, diffs, and results as
  coordination artifacts referenced from mailbox messages
- creates coordination groups over arbitrary sessions
- injects active coordination identity into the Team Mode system
  prompt
- uses a local HTTP/SSE broker for fast delivery with SQLite polling
  as durable fallback

Peer-session coordination state is stored in:

```text
~/.pi/agent/coordination.db
```

Set `MY_PI_COORDINATION_DB` to use a different SQLite database path.
The database uses WAL mode with schema and migrations under `src/db/`.
Sessions also connect to a local HTTP/SSE push broker on port `43191`
by default; set `MY_PI_COORDINATION_BROKER_PORT` to use another port.
SQLite remains the durable fallback if the broker is unavailable.

## Slash commands

```text
/team sessions
/team session list
/team session open <alias> [initial-message]
/team session send <session-id-or-name> <message>
/team session inbox [--all] [--full]
/team session read [message-id...]
/team session ack [message-id...]
/team group list
/team group create <name>
/team group join <group-id-or-name> [alias]
/team group open <group-id-or-name> <alias> [initial-message]
/team group send <group-id-or-name> <message>
```

## Tool actions

The `team` tool exposes peer-only coordination actions:

- `session_list`
- `session_send`
- `session_open`
- `session_inbox`
- `session_read`
- `session_ack`
- `session_wait`
- `group_create`
- `group_list`
- `group_join`
- `group_add_session`
- `group_send`
- `artifact_create`
- `artifact_get`
- `artifact_list`
- `message_send`
- `message_list`
- `message_wait`
- `message_read`
- `message_ack`

Use `session_open` only when you need to create a new teammate
session; prefer already-registered standby sessions for general
delegation. Opened sessions are headless Pi processes launched with a
restricted `team-mode` child environment, registered in the same
coordination DB, and resumable later through normal Pi session
primitives such as `/resume` or a direct session id/path. Mailbox
injections also update session visibility metadata, so
`/team sessions` and `team session_list` show the latest
delivered/read/acknowledged mailbox activity for humans opening or
resuming the teammate:

```bash
pi --session <opened-session-id-or-session-jsonl>
```

The launcher uses Pi `--mode rpc` only to keep a non-interactive Pi
process alive for later resume/inspection; initial work is delivered
by mailbox, not by private RPC ownership.

Use artifacts for larger handoffs and send artifact ids in mailbox
messages instead of pasting long content into peer messages.

## Mailbox semantics

Mailbox messages track three separate states:

- `delivered_at`: the message was queued or injected into the target
  session.
- `read_at`: the recipient has reviewed the message, but it may still
  need action.
- `acknowledged_at`: the recipient has fully processed the message and
  it is safe to suppress redelivery.

Use `session_read`/`message_read` after reviewing messages and
`session_ack`/`message_ack` after acting on them. `message_send`
supports `reply_to`, `ttl_ms`, and `requires_ack`; `message_wait` can
briefly wait for a matching peer reply.

## Standby sessions

A session can advertise itself as standby by saying it is standing by
or available for coordination. The extension records availability,
intent, and alias metadata so orchestrator sessions can discover and
message existing sessions before starting new work elsewhere.

## Development

Package scripts build transitive workspace dependencies first, then
this package:

```bash
pnpm --filter @spences10/pi-team-mode run check:self
pnpm --filter @spences10/pi-team-mode run test:self
pnpm --filter @spences10/pi-team-mode run build
```
