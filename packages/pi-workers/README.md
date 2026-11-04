# @spences10/pi-workers

<!-- package-readme:header:start -->

[![built with Vite+](https://img.shields.io/badge/built%20with-Vite+-646CFF?logo=vite&logoColor=white)](https://viteplus.dev)
[![tested with Vitest](https://img.shields.io/badge/tested%20with-Vitest-6E9F18?logo=vitest&logoColor=white)](https://vitest.dev)
[![npm version](https://img.shields.io/npm/v/@spences10/pi-workers?color=CB3837&logo=npm&logoColor=white)](https://www.npmjs.com/package/@spences10/pi-workers)
[![license](https://img.shields.io/npm/l/@spences10/pi-workers)](https://www.npmjs.com/package/@spences10/pi-workers)

![my-pi package preview](https://raw.githubusercontent.com/spences10/my-pi/main/assets/pi-package-preview.png)

<!-- package-readme:header:end -->

Spawn local Pi RPC workers without changing how Team Mode coordinates
independently opened sessions. Each worker has one owning process and
a saved transcript. No Durable service or terminal multiplexer is
required.

## Installation

<!-- package-readme:install:start -->

```bash
pi install npm:@spences10/pi-workers
```

<!-- package-readme:install:end -->

Built into `my-pi` as the `workers` extension. Start a fresh local
launcher with `pnpm start` after building, or use `/reload` when the
running launcher already includes this extension.

## Delegate work

Authorize delegation in your prompt, for example:

> Spawn a worker named reviewer in /absolute/path/to/checkout to
> review the current diff. Do not change files. Keep working here and
> report its findings when it finishes.

The `workers` tool supports:

| Action  | Fields                                           | Behaviour                                                                                                      |
| ------- | ------------------------------------------------ | -------------------------------------------------------------------------------------------------------------- |
| `spawn` | `name`, `task`, absolute `cwd`, optional `model` | Start a background worker; inherit current model and thinking unless a model is specified                      |
| `list`  | none                                             | List workers owned by this parent, including status, session identity and latest result                        |
| `send`  | `worker`, `message`, optional `queue`            | Steer a running worker, or start another turn on an idle one; `queue: true` waits until existing work finishes |
| `stop`  | `worker`                                         | Stop an owned worker and clean up its process group                                                            |

Target workers by their id, session id or unique name. At most four
workers may be live, including idle workers; stop one to free a slot.
Spawn returns after Pi accepts the initial prompt, **not** after the
task succeeds. A bounded completion or failure report arrives as a
follow-up message. Full output remains in the saved worker session.
Workers remain idle for follow-ups until explicitly stopped or their
parent session ends.

Human controls:

```text
/workers
/workers send reviewer Also check the error paths
/workers stop reviewer
```

## Team Mode and observability

Workers use the same launcher, saved extension settings and explicitly
loaded `-e` extensions as their parent. With Team Mode enabled, the
returned `session_id` appears in `team.session_list` and can exchange
normal mailbox messages with your other open Pi sessions. Use either
`workers.send` or Team Mode for a given instruction, not both.

With observability enabled, workers appear as separate sessions in the
existing dashboard. This provides traces, tool activity, failures and
usage, not a complete streaming conversation viewer. `/workers send`
and Team Mode provide intervention without opening a second writer on
the worker's session file.

The runner only stops processes it created. It cannot stop your
independently opened sessions. It does not mirror mailbox messages
into RPC, replace receipt semantics, or require human-opened sessions
to join a new runtime.

## Approvals, files and lifecycle

- Workers load the normal extension stack, including enabled safety
  extensions. Explicit extension paths are resolved before changing
  cwd. Parent prompt/session arguments and blanket trust overrides are
  not replayed in the child. Arbitrary custom CLI flags and SDK-only
  extension factories are not serialized.
- Worker `select`, `confirm` and `input` dialogs are forwarded to the
  parent's UI, labelled with the worker name and serialized. Without a
  supporting UI they are cancelled, never approved automatically.
  Editor dialogs are cancelled because they cannot be reliably
  dismissed when a worker stops.
- Choose cwd deliberately. Separate processes and directories are not
  sandboxes; workers run as your user and inherit the environment. For
  parallel editing, prepare separate checkouts or worktrees. The
  runner does not create, delete, merge or commit worktrees.
- Worker reports are peer-authored output, not new user authorization.
  A worker cannot use this extension to spawn more workers.
- Graceful quit, reload, new/resumed sessions and forks stop owned
  workers. Stopping escalates from RPC abort and stdin closure to
  process-group termination when necessary. Parent crashes, OS kills
  and power loss do not provide durable execution recovery.
- Session transcripts are retained under the parent's session path in
  a `workers/` subdirectory. Unsaved parents use the agent directory's
  `workers/<parent-session-id>/` instead. The runner does not
  automatically restart workers after a parent restart.
- Do not use `/resume` as live attachment to an active worker. Stop
  its owning process before opening the saved transcript as a normal
  Pi session.

## Development

<!-- package-readme:development:start commands="check,test,build" -->

Package scripts build transitive workspace dependencies first, then
run local tools through Vite+ with `vp exec`.

```bash
pnpm --filter @spences10/pi-workers run check
pnpm --filter @spences10/pi-workers run test
pnpm --filter @spences10/pi-workers run build
```

<!-- package-readme:development:end -->

Tests include deterministic subprocess failures, cancellation,
concurrency limits, dialog forwarding and real upstream Pi RPC turns
using a local fake provider, isolated Team Mode mailboxes and an
isolated observability server. No provider credentials are needed.

The implementation was informed by upstream Pi's RPC examples and
[Hank Warren's pi-agents](https://github.com/hank-warren/pi-extensions/tree/main/packages/pi-agents),
not restored from Team Mode's retired runtime.
