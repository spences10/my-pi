# @spences10/pi-team-mode

[![npm version](https://img.shields.io/npm/v/@spences10/pi-team-mode?color=CB3837&logo=npm)](https://www.npmjs.com/package/@spences10/pi-team-mode)
[![built with Vite+](https://img.shields.io/badge/built%20with-Vite+-646CFF?logo=vite&logoColor=white)](https://viteplus.dev)
[![tested with Vitest](https://img.shields.io/badge/tested%20with-Vitest-6E9F18?logo=vitest&logoColor=white)](https://vitest.dev)

Experimental Pi extension for local team orchestration with RPC
teammates, tasks, and mailbox-backed messages.

Maintained in the `my-pi` Vite+ workspace and tested with Vitest.

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

This package adds local multi-agent coordination to Pi:

- create and inspect teams
- spawn real RPC teammate sessions
- queue, claim, and update tasks
- send mailbox-backed direct messages
- steer, follow up with, wait for, or shut down teammates
- persist team state locally for the current project
- recover cleanly from stale local locks and orphaned teammate
  processes
- reject ambiguous teammate names and invalid task dependency graphs

Team state is stored under:

```text
~/.pi/agent/teams-local
```

Set `MY_PI_TEAM_MODE_ROOT` to use a different storage directory.

Team mode does not auto-attach old teams on startup. Use
`/team resume` to attach the latest team for the current repo. Use
`/team teams` to list all local teams and `/team switch` to pick one
from the TUI. Active teams show a compact footer status by default.
Use `/team ui off` to hide it for the current session, `/team ui full`
to show the below-editor widget when the team has useful detail, or
set `MY_PI_TEAM_UI=off|compact|auto|full`. Use
`/team ui style plain|badge|color` or
`MY_PI_TEAM_UI_STYLE=plain|badge|color` to tune visual emphasis. Use
`/team clear` to detach the current session from the active team UI.

RPC teammate processes receive a minimal child-process environment by
default, not the full parent `process.env`. Use
`MY_PI_TEAM_MODE_ENV_ALLOWLIST=NAME,OTHER_NAME` or the shared
`MY_PI_CHILD_ENV_ALLOWLIST` to pass selected ambient variables (for
example, provider credentials) to spawned teammates.

Headless RPC teammates auto-cancel extension UI prompts (`confirm`,
`select`, `input`, and `editor`) because there is no human inside the
child session. Design teammate prompts so they can proceed without
interactive confirmation, or steer them from the lead session when a
decision is needed.

For read-only research, spawning teammates in the shared cwd is fine.
For implementation work that writes files, use per-member worktree
mode:

```text
/team spawn alice --worktree --mutating --branch team/alice "claim one coding task"
```

The `team` tool exposes the same controls via `member_spawn` with
`workspace_mode: "worktree"`, `mutating: true`, and optional `branch`
or `worktree_path`. Team status shows each member's workspace path,
branch, and control state (`running (attached)` vs
`running orphaned`). Shared-cwd mutating spawns are refused when
another active mutating teammate is already using that cwd unless
`force`/`--force` is set. Worktrees are created under
`MY_PI_TEAM_MODE_ROOT/worktrees` by default and are never deleted
during shutdown; dirty worktrees are preserved until you clean them up
explicitly with git.

If a lead process restarts while teammate child processes are still
alive, `/team status` marks those persisted PIDs as orphaned. Use
`/team shutdown <member>` or `member_shutdown` to safely terminate a
known orphaned teammate process and clean up its member state. Before
signalling an orphan, team mode verifies the persisted process
identity (PID plus process start identity and command/session markers
where the platform exposes them) to avoid PID-reuse kills. Linux uses
`/proc` start ticks, command line, and cwd. Other platforms fall back
to `ps` start time and command line when available. If the platform
cannot provide enough identity to verify the process, orphan
shutdown/wait is refused and you must clean up manually.

Reusable teammate profiles are JSON files loaded from:

```text
~/.pi/agent/team-profiles/*.json
.pi/team-profiles/*.json
```

Project profiles override user profiles by name. In untrusted mode,
project profiles are skipped by default via
`MY_PI_TEAM_PROFILES_PROJECT=skip`; set it to `allow` to opt in for a
trusted repo. Profile fields include `description`, `model`,
`thinking`, `system_prompt`, `prompt`, `tools`, and `skills`:

```json
{
	"description": "Read-only code reviewer",
	"model": "anthropic/claude-sonnet-4-5",
	"thinking": "high",
	"system_prompt": "Review for correctness and security only.",
	"prompt": "Review the assigned task and report findings.",
	"tools": ["read", "bash"],
	"skills": ["research"]
}
```

Use a profile with `/team spawn alice --profile reviewer` or the
`member_spawn` tool parameter `profile`/`agent`. Explicit
`member_spawn` `model`, `thinking`, and `initial_prompt` override the
profile defaults.

Teammate names, assignees, senders, and recipients must be stable file
IDs: letters, numbers, dots, underscores, and hyphens only. This
avoids ambiguous local state paths like `alice/dev` and `alice-dev`
resolving to the same mailbox/member file.

Mailbox messages track three separate states:

- `delivered_at`: the message was injected into a session or accepted
  by a running teammate's RPC queue.
- `read_at`: the recipient has reviewed the message, but it may still
  need action.
- `acknowledged_at`: the recipient has fully processed the message and
  it is safe to suppress redelivery.

Use `message_read` to mark reviewed messages without acknowledging
work, and `message_ack` after acting on them. Both tool actions accept
optional `message_ids`; without IDs they update the whole inbox for
the member. Command equivalents are
`/team inbox <member> read [ids...]`,
`/team inbox <member> ack [ids...]`, `/team read <member> [ids...]`,
and `/team ack <member> [ids...]`. If a teammate exits after delivery
but before acknowledgement, unacknowledged deliveries are restored for
redelivery on the next session.

## Commands

```text
/team create demo
/team spawn alice "claim one task and report back"
/team task add alice: inspect the failing test
/team task show 1
/team task block 1 waiting on CI logs
/team task cancel 1 duplicate work
/team task reopen 1
/team task assign 1 bob
/team task unassign 1
/team dm alice status?
/team inbox alice read msg-id
/team ack alice msg-id
/team status
/team dashboard
/team results
/team teams
/team switch
/team ui style badge
/team resume
/team clear
```

Use `/team status` as the source of truth for member state, task
state, and mailbox activity. See
[docs/comparison-matrix.md](docs/comparison-matrix.md) for the
feature-parity gap check against comparable orchestration tools. Use
`/team dashboard` for a compact modal with members, task groups,
mailboxes, transcript paths, and available usage totals. Use
`/team results` to join completed task results into a single summary.
Assigned tasks stay queued until the assigned teammate claims them, so
the status view reflects actual work in progress. Use
`/team task block|cancel <id> [reason]`, `/team task reopen <id>`, and
`/team task assign|unassign` for manual lifecycle corrections.
Assigning a task changes ownership only; it does not reopen blocked or
cancelled work.

## Tool API

The extension also registers the `team` tool for agent-driven
orchestration. Important actions include:

- `team_create`
- `team_list`
- `member_spawn` (`profile`/`agent`, `workspace_mode: "worktree"`,
  `mutating: true`, optional `branch`/`worktree_path` for isolated
  coding work)
- `member_prompt`
- `member_follow_up`
- `member_steer`
- `member_wait`
- `task_create`
- `task_get`
- `task_claim_next`
- `task_update` (`clear_assignee` and `clear_result` clear optional
  fields)
- `message_send`
- `message_list`
- `message_read` to mark messages reviewed and `message_ack` to
  acknowledge processed mailbox messages; both support optional
  `message_ids` for partial inbox updates

Real work should use `member_spawn` from a lead session. Teammate-role
sessions reject `member_spawn` and `/team spawn` so nested teams
cannot be created accidentally. The fake teammate runner is kept out
of the tool API and is only available to local test harnesses.

## Using from a custom harness

```ts
import teamMode from '@spences10/pi-team-mode';

// pass `teamMode` as an ExtensionFactory to your Pi runtime
```

`my-pi` imports this package directly and enables it as the built-in
team mode extension. When `my-pi` spawns a teammate it starts the
child with `--no-team-mode -e <team-extension>`, so the child loads
exactly one team-mode extension. Custom harnesses that already bundle
team mode should use the same pattern: disable the bundled copy when
also passing this package through `-e`, or avoid `-e` and rely only on
the bundled factory.

## Development

```bash
pnpm --filter @spences10/pi-team-mode run check
pnpm --filter @spences10/pi-team-mode run test
pnpm --filter @spences10/pi-team-mode run build
```

## License

MIT
