---
name: create-harness
# prettier-ignore
description: Use when creating executable /tmp Pi task harnesses for ambiguous or high-risk coding work. Builds contract, prompts, validation, logs, and enforcement rules.
compatibility:
  Requires my-pi or Pi with the pi-harness extension tools enabled.
---

# Create Harness

Create a real my-pi task harness, not a prose-only plan. The harness
must live in `/tmp` and be created with the `harness_create` tool
after context gathering. It is control state, not a worktree, and
repository changes do not live inside it.

## Use threshold

Use a harness when a task benefits from an enforceable execution
contract because it has material risk, unresolved scope, destructive
effects, or complex coordination. Good candidates include broad
uncertain refactors, migrations, deployments, risky releases, external
side effects, and explicit user requests.

Use the normal direct workflow for bounded, low-risk work that
standard validation can verify, including:

- routine documentation or copy edits
- focused single-file fixes
- configuration or metadata updates
- test expectation changes
- formatting and other low-risk maintenance
- reviewed commit or push follow-ups

Before creation, identify the contract benefit and the risk, scope, or
coordination need it controls.

## Workflow

1. Recover context with read-only tools first: docs, package READMEs,
   source, tests, git, LSP, recall, browser, or MCP as relevant.
2. Establish source of truth: list the concrete files, commands, docs,
   or evidence the harness is grounded in.
3. Challenge assumptions: identify uncertainties and whether the
   executor may decide or must escalate.
4. Define both layers: the outer policy contains workspace/verifier
   protections; the inner scaffold contains task scope, validation,
   test strategy, and model roles.
5. Call `harness_create` with the task and contract fields.
6. If the `team` tool is available, create or reuse a team and call
   `task_create` with the harness directory in the description.
7. Read back the created harness path and report how to run it with
   `/harness run <dir>`.

## Policy and Scaffold Guidance

- Outer policy fields (`cwd`, forbidden paths/commands, tool surface,
  dirty baseline) are runtime-owned and cannot be weakened by
  `harness_amend`.
- Inner scaffold fields (task, allowed paths, validation, test policy,
  model roles, escalation rules) are versioned and amendable when user
  direction or evidence changes.
- The scaffold is subordinate to system, developer, and current user
  instructions.

- Never create a replacement harness merely to escape the guard of a
  completed run. Completion seals its evidence for the current turn;
  the extension deactivates it on the next direct user turn or session
  startup.
- Keep `allowed_paths` narrow. Use `.` only when the task genuinely
  spans the repo.
- Set `allow_test_changes: false` unless changing tests is explicitly
  part of the task.
- Include validation commands whenever the project has a known check
  path.
- Add `forbidden_commands` for task-specific hazards.
- Do not implement the task during harness creation unless the user
  explicitly asks for combined create/run.
- Do not spawn a teammate during creation; save spawning for the run
  phase.

## Output

Report only:

- harness directory
- source-of-truth inputs used
- allowed scope
- validation commands
- team task id if one was created
- open decisions or escalation triggers
