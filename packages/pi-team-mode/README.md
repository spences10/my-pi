# @spences10/pi-team-mode

[![built with Vite+](https://img.shields.io/badge/built%20with-Vite+-646CFF?logo=vite&logoColor=white)](https://viteplus.dev)
[![tested with Vitest](https://img.shields.io/badge/tested%20with-Vitest-6E9F18?logo=vitest&logoColor=white)](https://vitest.dev)
[![npm version](https://img.shields.io/npm/v/@spences10/pi-team-mode?color=CB3837&logo=npm&logoColor=white)](https://www.npmjs.com/package/@spences10/pi-team-mode)
[![license](https://img.shields.io/npm/l/@spences10/pi-team-mode)](https://www.npmjs.com/package/@spences10/pi-team-mode)

![my-pi package preview](https://raw.githubusercontent.com/spences10/my-pi/main/assets/pi-package-preview.png)

Experimental persistent teammate coordination for Pi. `pi-team-mode`
registers Pi sessions in a local SQLite coordination bus, sends
mailbox-backed peer messages, creates visible teammate sessions,
stores larger handoff artifacts, and coordinates groups of
independently started sessions. The package is moving toward one
persistent owning runtime per teammate; that runtime is not a stable
release guarantee yet.

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
- tracks PID-backed registrations and marks stale peers offline on
  supported tool paths
- creates visible teammate sessions with an experimental persistent
  single-owner runtime
- routes accepted persistent-runtime messages as native Pi prompt,
  steering, or follow-up turns
- sends compact mailbox-backed peer messages between independently
  started sessions
- stores larger handoffs, plans, findings, logs, diffs, and results as
  coordination artifacts referenced from mailbox messages
- creates coordination groups over arbitrary sessions
- injects active coordination identity into the Team Mode system
  prompt
- uses a local HTTP/SSE broker for fast delivery with SQLite polling
  as durable fallback

## Experimental persistent runtime

Enable the opt-in persistent path before starting the lead Pi process:

```bash
# Use an isolated DB while switching between local and published builds.
MY_PI_TEAM_RUNTIME=persistent \
MY_PI_COORDINATION_DB=/tmp/pi-team-mode-dogfood.db \
pnpm start
```

Released upgrades use the normal shared database and numbered
migrations. Do not point an older published build at a database
already upgraded by unreleased local code.

In this mode, `member_spawn` starts one detached SDK runtime that owns
the teammate session, waits for runtime readiness and initial-prompt
acceptance, and returns structured runtime status. Later
`session_send` calls route to that owner as native prompt, steering,
or follow-up turns. Runtime generations, ownership leases, process
identity, state transitions, and bounded diagnostics are persisted in
SQLite. The launcher supervises the detached host while it is running:
startup crashes fail readiness immediately, readiness timeouts
terminate the unready host, and later exit codes or signals move the
runtime to `failed` with bounded, redacted stderr. Graceful shutdown
moves it to `offline`; a subsequent spawn recovers the same session id
with a new runtime generation after proving the prior owner dead.
Child runtimes receive a minimal environment; add explicitly required
variables with `MY_PI_TEAM_MODE_ENV_ALLOWLIST` or
`MY_PI_CHILD_ENV_ALLOWLIST`.

The legacy wake path remains the default during dogfood. The
persistent path is still experimental: live `/resume` attachment,
crash-safe exactly-once delivery and atomic recursive
spawn/concurrency reservations are not complete. See the
[comparison matrix](./docs/comparison-matrix.md) and
[release/dogfood checklist](./docs/release-checklist.md) for the exact
status and release gates.

### Known `/resume` attach limitation

Upstream Pi's `/resume` starts a session process; it cannot attach an
interactive TUI to an already-running process that owns the same
session. Until upstream exposes an attach primitive, `/resume` must
not be described or used as a live attach operation for an active
persistent teammate. Stop/detach the owner before resuming the session
interactively, and do not run two writers against one session file.
Live attach/detach remains blocked by this upstream limitation.

Peer-session coordination state is stored in:

```text
~/.pi/agent/coordination.db
```

Set `MY_PI_COORDINATION_DB` to use a different SQLite database path.
The database uses WAL mode. Immutable numbered files under
`src/db/migrations/` are the schema source of truth for both fresh and
existing databases; builds generate `dist/db/schema.sql` as an
inspection snapshot. Sessions also connect to a local HTTP/SSE push
broker on port `43191` by default; set
`MY_PI_COORDINATION_BROKER_PORT` to use another port. SQLite remains
the durable fallback if the broker is unavailable.

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

The `team` tool exposes peer-only coordination actions. Use
`session_list` with `mode=full` to include offline sessions plus
persistent runtime ids, generations, PIDs, terminal signals/errors,
and bounded diagnostics.

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
- `member_spawn`

Use `member_spawn` with `name`, `workspace_mode`, and optional
`instructions` to create a visible teammate session. Choose `shared`
explicitly to reuse the lead cwd. Choose `isolated` with an absolute
`workspace_path` to use a distinct directory; active sessions cannot
claim the same isolated path.

### Workspace and trust boundaries

`shared` is an explicit acknowledgement that teammates may read and
mutate the lead's cwd concurrently. `isolated` provides coordination
ownership for a caller-provided directory; it does not create a
worktree, container, branch, or OS sandbox. Both Git worktrees
(including dirty worktrees) and non-Git directories are supported, and
Team Mode never cleans or deletes them. The caller remains responsible
for creating the directory, choosing branch/worktree boundaries, and
reviewing mutations. Environment allowlisting and diagnostic redaction
reduce accidental credential exposure but do not make untrusted model
or shell execution safe. Add `reply_to` or comma/space-separated `to`
recipients when the teammate's final report should go directly to an
orchestrator, peer, or cross-project session instead of only its
creator. Initial instructions and later native turns are recorded in
the teammate transcript. With `MY_PI_TEAM_RUNTIME=persistent`, spawn
waits for runtime readiness and Pi prompt preflight acceptance; that
is not the same as successful task completion. Mailbox state or a
session file alone is never evidence that a model turn completed. Do
not use `/resume` as an attachment mechanism while the persistent
runtime is active; see the known limitation above.

For deterministic checks that do not need a model turn, `member_spawn`
accepts `command` instead of `instructions`; the two fields are
mutually exclusive, and `command` must contain executable shell text
rather than natural-language task instructions. The command runs in
the teammate's project cwd, records start/result entries in the
teammate transcript, and sends the captured exit code/stdout/stderr
from the teammate session id to the creator plus any `reply_to`/`to`
report recipients.

Use artifacts for larger handoffs and send artifact ids in mailbox
messages instead of pasting long content into peer messages.

`session_wait` waits on the caller's inbox. Pass `from` to wait for a
specific sender; `to` is also accepted as a sender filter for
compatibility with older prompts. Use `member` only when intentionally
reading another registered inbox.

## Three-tier team orchestration

Team Mode supports hierarchical responsibility with flat messaging:

1. A main orchestrator creates the mission group, spawns or adds team
   leads, and synthesizes final results.
2. Team leads coordinate focused worker sessions and report compact
   status, blockers, and artifact ids back to the orchestrator.
3. Workers do scoped implementation, research, review, or validation
   tasks and leave resumable session history. Workers may also message
   the orchestrator or any other relevant session directly when the
   task asks for direct report recipients or cross-project
   coordination.

Any session can still message any other session through the local
coordination bus. Session ids remain targetable after a peer goes
offline, so spawned teammates can send mailbox replies back to their
creator or lead even if that session is not currently open.

## Mailbox semantics

Mailbox messages expose three separate receipt fields:

- `delivered_at`: the message was queued or injected into the target
  session.
- `read_at`: the recipient has reviewed the message, but it may still
  need action.
- `acknowledged_at`: the recipient has fully processed the message and
  it is safe to suppress redelivery.

Use `session_read`/`message_read` after reviewing messages and
`session_ack`/`message_ack` after acting on them. Persistent delivery
sets `delivered_at` only after the owning runtime accepts the native
turn; read and acknowledgement remain explicit. Receipt fields are not
yet a crash-safe exactly-once execution guarantee. `message_send`
supports `reply_to`, `ttl_ms`, and `requires_ack`; `message_wait` can
briefly wait for a matching peer reply.

## Standby sessions

A session can advertise itself with an explicit stand-by or
coordination prompt. The extension records availability and intent so
orchestrator sessions can discover existing sessions before starting
new work elsewhere. Standby phrase recognition remains experimental.

## Development

Package scripts build transitive workspace dependencies first, then
this package:

```bash
pnpm --filter @spences10/pi-team-mode run check:self
pnpm --filter @spences10/pi-team-mode run test:self
pnpm --filter @spences10/pi-team-mode run coverage:self
pnpm --filter @spences10/pi-team-mode run test:pack
pnpm --filter @spences10/pi-team-mode run test:release
pnpm --filter @spences10/pi-team-mode run build
```
