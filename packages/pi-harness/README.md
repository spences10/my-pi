# @spences10/pi-harness

<!-- package-readme:header:start -->

[![built with Vite+](https://img.shields.io/badge/built%20with-Vite+-646CFF?logo=vite&logoColor=white)](https://viteplus.dev)
[![tested with Vitest](https://img.shields.io/badge/tested%20with-Vitest-6E9F18?logo=vitest&logoColor=white)](https://vitest.dev)
[![npm version](https://img.shields.io/npm/v/@spences10/pi-harness?color=CB3837&logo=npm&logoColor=white)](https://www.npmjs.com/package/@spences10/pi-harness)
[![license](https://img.shields.io/npm/l/@spences10/pi-harness)](https://www.npmjs.com/package/@spences10/pi-harness)

![my-pi package preview](https://raw.githubusercontent.com/spences10/my-pi/main/assets/pi-package-preview.png)

<!-- package-readme:header:end -->

Build and run ephemeral task harnesses with my-pi primitives. A
harness is a `/tmp` runtime containing a machine-readable contract,
executor prompt, task brief, validation script, review script, logs,
status, and runtime enforcement. Inspired by Ornith's self-scaffolding
design, the runtime separates an immutable outer policy from a
versioned, amendable inner scaffold.

## Installation

<!-- package-readme:install:start -->

```bash
pi install npm:@spences10/pi-harness
```

<!-- package-readme:install:end -->

Local development from this monorepo:

```bash
pnpm --filter @spences10/pi-harness run build
pi install ./packages/pi-harness
# or for one run only
pi -e ./packages/pi-harness
```

## What it does

`pi-harness` adds:

- `/harness` command for create, run, review, status, use, and clear
- `harness_create` tool to create `/tmp/my-pi-harness-*` runtimes
- `harness_amend` tool for audited, versioned changes to the inner
  scaffold
- `harness_update` tool for phase/status/evidence logging
- generated `OUTCOME.md` and `outcome.json` review artifacts
- dirty-baseline tracking so pre-existing repo changes are reported
  but not treated as task drift
- worktree-aware validate/review scripts for team-mode executors
- `harness_read` tool for summaries
- `before_agent_start` context injection for the active harness
- `tool_call` enforcement for edit/write paths and forbidden commands
- compact TUI status for the active harness
- bundled `create-harness`, `execute-harness`, and `review-harness`
  skills

## Runtime layout

```text
/tmp/my-pi-harness-<id>/
  harness.json      # outer policy, versioned inner scaffold, amendment history
  SYSTEM.md         # executor system prompt
  TASK.md           # task brief and required loop
  status.json       # phase/status/evidence log
  OUTCOME.md        # reviewable outcome summary
  outcome.json      # machine-readable outcome summary
  outcome.mjs       # outcome artifact refresher
  validate.sh       # validation runner
  review.sh         # drift/review helper
  logs/events.jsonl # append-only event log
```

## Commands

```text
/harness create <task>
/harness run <dir>
/harness review <dir>
/harness status [dir]
/harness use <dir>
/harness clear
```

The create/run/review commands prompt the model to use the bundled
skills. The tools provide the actual runtime and enforcement layer.

`harness.json` contains two deliberately different layers:

- `policy`: runtime-owned workspace and verifier protections such as
  cwd, forbidden paths/commands, available tools, and the dirty
  baseline. Executors cannot weaken these through amendments.
- `scaffold`: the model's task interpretation and execution strategy,
  including allowed paths, validation, test policy, and model roles.
  It is subordinate to system, developer, and current user
  instructions and can be revised with `harness_amend`.

Every scaffold amendment increments its version, records its reason
and requester, regenerates runtime prompts/scripts, and appends an
audit event. A harness enforcement block reports a contract mismatch;
it is not a platform-policy refusal. When a harness is active, the TUI
shows a compact footer/status indicator; use `/harness status [dir]`
or `harness_read` for the full contract, task, validation, and outcome
details.

A terminal `completed` or `failed` status seals the run and its
evidence but deliberately does not deactivate enforcement: an executor
must not be able to escape the outer policy by declaring its own work
complete. Use `/harness clear` to explicitly deactivate the finished
harness before unrelated follow-up work. Clearing or deleting a
harness affects only its `/tmp` control state; repository changes
remain in the working tree. Do not create a new harness merely to
commit or push already-reviewed work. A risky release, deployment,
migration, or destructive operation can still justify a dedicated
harness when explicitly requested or warranted by its actual risk.

Harnesses snapshot dirty files at creation time. Review and outcome
artifacts focus on changes after that baseline, while still recording
baseline files in `outcome.json`. If a team-mode executor runs in a
linked git worktree, run `review.sh` from that worktree or set
`HARNESS_CWD` so validation, guard checks, and outcome collection use
the executor workspace.

## Harness loop

1. Context recovery
2. Source-of-truth capture
3. Assumption challenge
4. Alignment checkpoint
5. Surgical execution
6. Validation evidence
7. Drift review
8. OUTCOME.md/outcome.json review
9. Delta/risk report

## Using from a custom harness

```ts
import harness from '@spences10/pi-harness';

// pass `harness` as an ExtensionFactory to your Pi runtime
```

`my-pi` imports this package directly and enables it as the built-in
harness workflow.

## Development

```bash
pnpm --filter @spences10/pi-harness run check
pnpm --filter @spences10/pi-harness run test
pnpm --filter @spences10/pi-harness run build
```

## License

MIT
