# @spences10/pi-harness

<!-- package-readme:header:start -->

[![built with Vite+](https://img.shields.io/badge/built%20with-Vite+-646CFF?logo=vite&logoColor=white)](https://viteplus.dev)
[![tested with Vitest](https://img.shields.io/badge/tested%20with-Vitest-6E9F18?logo=vitest&logoColor=white)](https://vitest.dev)
[![npm version](https://img.shields.io/npm/v/@spences10/pi-harness?color=CB3837&logo=npm&logoColor=white)](https://www.npmjs.com/package/@spences10/pi-harness)
[![license](https://img.shields.io/npm/l/@spences10/pi-harness)](https://www.npmjs.com/package/@spences10/pi-harness)

![my-pi package preview](https://raw.githubusercontent.com/spences10/my-pi/main/assets/pi-package-preview.png)

<!-- package-readme:header:end -->

Prompt guidance uses Pi's named system-prompt sections. It coexists
with user `SYSTEM.md` and `APPEND_SYSTEM.md` files and other
extensions without replacing the complete prompt. Idle sessions get a
brief discovery hint when harness tools, codemode, or tool search are
selected. An active harness or assessment replaces that hint with its
current task guidance.

Optional task scaffolding for Pi: a contract, working-state baseline,
validation scripts, progress log, and reviewable outcome. Pi still
owns the agent loop, sessions, tools, and permission hooks.

Use direct work for routine changes. Use a harness when the user asks
for one or a concrete execution contract adds value. Assessment is
optional advice, not a prerequisite or a read-only security mode.

## Install

<!-- package-readme:install:start -->

```bash
pi install npm:@spences10/pi-harness
```

<!-- package-readme:install:end -->

## Create and execute

```text
/harness create <task>
```

The agent calls `harness_create` with the task and at least one
accepted validation command. Scope defaults to the project; provide
`allowed_paths` to narrow it. Normal project test development is
allowed by default. Set `allow_test_changes: false` only when the task
explicitly requires protecting those files.

Creation does not require a separate assessment or approval roundtrip.
It does not authorize new capabilities, commits, pushes, releases,
deployments, destructive operations, or peer collaboration beyond the
user's request.

The runtime lives under `/tmp/my-pi-harness-<id>/`:

- `harness.json`: accepted maximum scope and checks, plus the
  execution scaffold and amendment history.
- `TASK.md` and `SYSTEM.md`: task and workflow guidance.
- `validate.sh` and `review.sh`: manual validation and drift review.
- `status.json` and `logs/`: progress, executed checks and output.
- `OUTCOME.md` and `outcome.json`: review artifacts.

### Completion means checks ran

Request `status: completed` through `harness_update`. The extension
runs the accepted commands, any additional scaffold checks, and the
drift guard through Pi's normal nested Bash tool pipeline. Permission
hooks, cancellation and tool-result handling still apply.

Completion requires successful checks against an unchanged contract
and Git-visible working state. A failure, denied tool, interruption or
concurrent change cannot become success merely because an agent writes
“passed”. Results include executed-check records and output-file
references. Manual evidence strings are self-reported notes, not
validation proof.

Failed checks can be fixed and retried; there is no one-attempt
escalation rule. Completed runs reject further API amendments and
status mutations. Their active guard clears on the next direct user
turn or session startup; do not create another harness just to commit
already-reviewed work.

### Amend strategy, not acceptance

`harness_amend` records a versioned strategy change. It cannot remove
or replace the accepted validation commands or relax an explicit
no-test-edit restriction. Additional checks are allowed. Scaffold
scope always intersects the accepted maximum scope, so broadening a
strategy does not grant access outside the contract.

A genuinely larger task needs user authorization and a new contract,
not an executor-authored relaxation of its own acceptance criteria.

### Baseline and worktrees

Dirty files are fingerprinted without changing the working tree, HEAD
or Git index. Later content, index, mode, symlink, deletion and rename
changes remain visible, including initially untracked files. Only
fingerprints are saved, not file contents.

A baseline belongs to the workspace where it was captured. Linked
worktrees use their own Git state, without another workspace's dirty
file exemptions. Run manual scripts from the execution worktree or set
`HARNESS_CWD`. Completion uses the current Pi execution directory and
rejects unrelated repositories.

### Optional assessment

`/assess <task>`, `harness_assess` and `harness_assessment_submit`
record evidence, existing primitives and a recommendation. Tools,
native codemode, discovery and MCP remain available. This is advisory
investigation: it does not enforce read-only access or add an approval
queue. Normal user authorization still applies.

## Commands and tools

```text
/harness create <task>
/harness run [dir]
/harness review [dir]
/harness status [dir]
/harness use <dir>
/harness clear
/assess <task>
/assess status
/assess clear
```

`/harness use <dir>` confirms the selected harness directory.
`/harness clear` confirms when the active harness is cleared, or
reports that there is no active harness to clear.

Tools: `harness_create`, `harness_amend`, `harness_update`,
`harness_read`, `harness_assess`, `harness_assessment_submit`.

All six use Pi's native `codemode` exposure: callable through scripts
without adding six direct tool definitions to the model's loadout. Use
`tools.harness_create(...)`, `tools.harness_update(...)`, and the
other tool names inside codemode. Pi's `tool_search` can discover and
activate them, or select them explicitly for direct calls. Without
codemode, activate the required tools directly. Mutating harness tools
remain sequential, and nested calls retain normal permission hooks and
cancellation, including Bash checks run during completion. Validation
runs on completion, not automatically after edits or turns.

Execution is direct by default. Team Mode can coordinate independently
opened peers only when the user authorizes collaboration. This package
does not spawn or supervise workers.

## Skills

The package ships five skills under [`skills/`](./skills):

- `create-harness`, `execute-harness` and `review-harness` cover the
  harness workflow above.
- `create-repeatable-task` saves a task you want to run again as a
  project skill in `.agents/skills/<name>/`, with its validation
  commands. Running that skill creates a harness, executes it, then
  reviews the session trace.
- `review-session-trace` is a read-only retrospective. It reads a
  saved Pi session file, plus harness artifacts when present, for
  failed tool calls the agent worked around, wasted effort and checks
  that did not cover the task. It reports proposed improvements and
  does not apply them. It does not need an active harness.

Both skills use the `telemetry` tool from
[pi-telemetry](https://github.com/spences10/my-pi/tree/main/packages/pi-telemetry#agent-tool)
when it is installed. Tasks label recordings using the skill name,
then request a stop after execution and validation. Pi finishes the
recording at `turn_end`; review follows in the next turn and compares
closed recordings for the same project, suite and task. Existing
user-enabled recording stays on, and unfinished metrics are treated as
provisional. Neither skill needs telemetry.

Trace review follows the task's session entry IDs and `parentId`
branch links, rather than treating the whole JSONL file as one linear
conversation. Relevant abandoned attempts are reviewed separately.
Task success, passing validation and closed telemetry are distinct
outcomes.

## Safety and compatibility

This is workflow scaffolding, **not an OS sandbox**. Direct edit/write
hooks and final Git drift checks enforce the accepted paths through
those interfaces. Shell commands and other tools retain the host
user's permissions and can modify control files; the runtime is not a
security boundary against hostile code. Use OS/container isolation for
that threat model. Explicit `forbidden_commands` are optional
substring checks, not a general shell parser.

Existing temporary runtimes keep old generated scripts: recreate them
before relying on these changes. Contracts without accepted checks and
scope cannot complete or amend through the current API.

For programmatic consumers, `create_harness_runtime` now requires
`validation_commands`. `update_harness_runtime` is asynchronous;
completion requires a trusted `HarnessVerificationOptions.run` backend
that executes the supplied commands in the supplied cwd and respects
the signal. The extension supplies this through Pi's tool pipeline.
Removed assessment-locking helpers are no longer exported.

## Development

```bash
pnpm --filter @spences10/pi-harness run check
pnpm --filter @spences10/pi-harness run test
pnpm --filter @spences10/pi-harness run build
```
