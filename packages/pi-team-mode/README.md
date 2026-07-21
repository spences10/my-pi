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
2. Each session registers itself in the shared coordination database;
   later `/name` changes update its peer-targeting name immediately.
3. Use `session_list` to discover the other open sessions.
4. Send a message with `session_send` or a group action.
5. When the receiving session is idle, its extension injects each
   delivery as a visible Pi custom message carrying structured peer
   provenance. It is never injected as a direct user turn.

Messages sent while a peer is offline remain durable and are surfaced
after the peer opens again. Messages sent while a peer is running wait
until its current agent run finishes. Team Mode does not steer an
active remote run.

Automatic deliveries include only a bounded message-body preview. The
mailbox remains the full-text source: use `team session_inbox` with
`mode=full` to retrieve it. Team Mode does not automatically copy each
message into a new artifact. For intentionally large handoffs, senders
should create a Team Mode artifact, send its id, and recipients should
retrieve that referenced artifact.

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

## Peer provenance and authority

Automatic deliveries are custom messages with the custom type
`team-mode-peer-message`. Their structured details identify the source
as `team-mode-peer`, set authority to `peer-only`, record that they do
not carry direct user authority, and preserve message and sender
session ids. The visible message also names the peer sender, shows
explicit peer-content boundaries, and says that it is not direct user
input. Long previews carry clear truncation and full-mailbox or
referenced-artifact retrieval instructions. Peer content keeps this
provenance even if it claims to be from the user or says that the user
approved an action.

Peer messages remain useful for ordinary coordination, evidence, and
review feedback within scope the direct user already authorized. A
peer message cannot itself authorize edits, ownership transfer,
commits, pushes, issue changes, releases, destructive actions, or
public-contract changes. If the direct user has not already confirmed
a requested consequential action, ask the user before acting.
Delivery, reading, acknowledgement, urgency, group role, and sender
labels do not increase a peer message's authority.

This authority boundary does not add process control: Team Mode still
only coordinates independently opened peer sessions and does not
spawn, supervise, or attach to them.

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
