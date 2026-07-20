# @spences10/pi-team-mode

<!-- package-readme:header:start -->

[![built with Vite+](https://img.shields.io/badge/built%20with-Vite+-646CFF?logo=vite&logoColor=white)](https://viteplus.dev)
[![tested with Vitest](https://img.shields.io/badge/tested%20with-Vitest-6E9F18?logo=vitest&logoColor=white)](https://vitest.dev)
[![npm version](https://img.shields.io/npm/v/@spences10/pi-team-mode?color=CB3837&logo=npm&logoColor=white)](https://www.npmjs.com/package/@spences10/pi-team-mode)
[![license](https://img.shields.io/npm/l/@spences10/pi-team-mode)](https://www.npmjs.com/package/@spences10/pi-team-mode)

![my-pi package preview](https://raw.githubusercontent.com/spences10/my-pi/main/assets/pi-package-preview.png)

<!-- package-readme:header:end -->

Peer-session coordination for independently opened Pi TUI sessions.
The package registers each running session in a local SQLite bus,
delivers durable messages, stores larger artifacts, and coordinates
groups. It does not spawn, supervise, or attach to other Pi sessions.

## Installation

<!-- package-readme:install:start -->

```bash
pi install npm:@spences10/pi-team-mode
```

<!-- package-readme:install:end -->

Local development from this monorepo:

```bash
pnpm --filter @spences10/pi-team-mode run build
pi install ./packages/pi-team-mode
# or for one run only
pi -e ./packages/pi-team-mode
```

## How it works

1. Open two or more normal Pi TUI sessions with Team Mode installed.
2. Each session registers itself in the shared coordination database.
3. Use `session_list` to discover the other open sessions.
4. Send a message with `session_send` or a group action.
5. The receiving extension injects queued messages as native user
   turns when that session is idle.

Messages sent while a peer is offline remain durable and are surfaced
after the peer opens again. Messages sent while a peer is running wait
until its current agent run finishes. Team Mode does not steer an
active remote run.

Coordination state is stored in:

```text
~/.pi/agent/coordination.db
```

Set `MY_PI_COORDINATION_DB` to use a different SQLite database.
Sessions also use a local HTTP/SSE broker on port `43191` for prompt
notification, with SQLite polling as the durable fallback.

## Slash commands

```text
/team sessions
/team session list
/team session send <session-id-or-name> <message>
/team session inbox [--all] [--full]
/team session read [message-id...]
/team session ack [message-id...]
/team group list
/team group create <name>
/team group join <group-id-or-name> [alias]
/team group send <group-id-or-name> <message>
```

## Tool actions

- `session_list`
- `session_send`
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

`message_*` actions are compatibility aliases for the corresponding
peer mailbox operations. Use artifacts for larger handoffs and send
artifact ids in messages instead of copying large bodies.

## Receipt semantics

- `delivered_at`: the message was injected into the owning open
  session.
- `read_at`: the recipient reviewed the message.
- `acknowledged_at`: processing is complete and redelivery can be
  suppressed.

Mailbox state is coordination evidence, not proof that a model
completed work. Use `session_read` after reviewing a message and
`session_ack` after completing it.

## Groups and standby sessions

Groups organize independently running sessions without changing who
may talk to whom. A session can advertise an intent such as
standby/reviewer through its prompt, allowing another session to
discover and coordinate with it. Opening, closing, naming, and
isolating those Pi processes remains the user's responsibility.

## Database compatibility

Released numbered migrations are immutable. Schema version 4 contains
dormant persistent-runtime tables from an earlier experiment so
databases upgraded by version `0.0.48` continue to open safely.
Peer-only Team Mode does not read or write those tables.

## Development

```bash
pnpm --filter @spences10/pi-team-mode run check:self
pnpm --filter @spences10/pi-team-mode run test:self
pnpm --filter @spences10/pi-team-mode run coverage:self
pnpm --filter @spences10/pi-team-mode run test:pack
pnpm --filter @spences10/pi-team-mode run test:release
pnpm --filter @spences10/pi-team-mode run build
```
