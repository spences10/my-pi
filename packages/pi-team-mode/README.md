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

This package adds local multi-agent coordination primitives to Pi:

- create and inspect teams
- spawn real RPC teammate sessions
- assign, claim, and update tasks
- send mailbox-backed direct messages
- steer, follow up with, wait for, or shut down teammates
- persist team state locally for the current project

Team state is stored under:

```text
~/.pi/agent/teams-local
```

Set `MY_PI_TEAM_MODE_ROOT` to use a different storage directory.

Team mode does not auto-attach old teams on startup. Use
`/team resume` to attach the latest team for the current repo. Active
teams show a compact footer status by default. Use `/team ui off` to
hide it for the current session, `/team ui full` to show the
below-editor widget, or set `MY_PI_TEAM_UI=off|compact|auto|full`. Use
`/team clear` to detach the current session from the active team UI.

RPC teammate processes receive a minimal child-process environment by
default, not the full parent `process.env`. Use
`MY_PI_TEAM_MODE_ENV_ALLOWLIST=NAME,OTHER_NAME` or the shared
`MY_PI_CHILD_ENV_ALLOWLIST` to pass selected ambient variables (for
example, provider credentials) to spawned teammates.

## Commands

```text
/team create demo
/team spawn alice "claim one task and report back"
/team task add alice: inspect the failing test
/team dm alice status?
/team status
/team resume
/team clear
```

Use `/team status` as the source of truth for member state, task
state, and mailbox activity.

## Tool API

The extension also registers the `team` tool for agent-driven
orchestration. Important actions include:

- `team_create`
- `member_spawn`
- `member_prompt`
- `member_follow_up`
- `member_steer`
- `member_wait`
- `task_create`
- `task_claim_next`
- `task_update`
- `message_send`
- `message_list`

`fake_teammate_step` exists only for local tests and evals; real work
should use `member_spawn`.

## Using from a custom harness

```ts
import teamMode from '@spences10/pi-team-mode';

// pass `teamMode` as an ExtensionFactory to your Pi runtime
```

`my-pi` imports this package directly and enables it as the built-in
team mode extension.

## Development

```bash
pnpm --filter @spences10/pi-team-mode run check
pnpm --filter @spences10/pi-team-mode run test
pnpm --filter @spences10/pi-team-mode run build
```

## License

MIT
