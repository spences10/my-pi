---
name: execute-harness
# prettier-ignore
description: Use when running an existing /tmp Pi task harness. Executes inside the active contract, records status, respects enforcement, and loops through validation.
compatibility:
  Requires my-pi or Pi with the pi-harness extension tools enabled.
---

# Execute Harness

Run the task through an existing my-pi harness. Its outer policy is
the runtime trust boundary; its versioned inner scaffold is an
amendable execution plan subordinate to system, developer, and current
user instructions.

## Workflow

1. Resolve the harness directory from the user request or active
   harness context.
2. Read `harness.json`, `SYSTEM.md`, `TASK.md`, and `status.json`
   before editing.
3. Call `harness_update` with `status: running` and the current phase.
4. If the `team` tool is available and you are the team lead, create
   or reuse a team, create/claim a task for the harness, and use one
   `member_spawn` executor with `mutating: true` for file-editing
   work. Default to the contract `cwd`; use `workspace_mode: worktree`
   only when the user asks for isolation or the plan covers setup,
   runtime state, merge, and cleanup ownership.
5. The teammate prompt must tell it to read `harness.json`,
   `SYSTEM.md`, `TASK.md`, and `status.json`, execute only inside the
   contract, run `validate.sh` and `review.sh`, update harness
   evidence, and report changed files plus risks. If using a worktree,
   set `HARNESS_CWD` to that worktree for validation and review.
6. Recover any remaining source-of-truth context needed to act safely.
7. Execute surgically inside `scaffold.allowed_paths`. If user
   direction or source evidence changes legitimate scope or strategy,
   use `harness_amend` and record the reason rather than treating the
   scaffold as immutable.
8. Record decisions, phase changes, and validation evidence with
   `harness_update`, including team status and remaining risks when
   known.
9. Run `<harness_dir>/validate.sh`.
10. Run `<harness_dir>/review.sh` from the execution workspace. If
    using a linked worktree, run it from that worktree or set
    `HARNESS_CWD` to the worktree path.
11. Review `<harness_dir>/OUTCOME.md` or `<harness_dir>/outcome.json`
    for changed files, baseline ignored files, validation evidence,
    team status, and risks.
12. Mark `completed` only when validation passes and no escalation
    rule applies; otherwise mark `failed` with evidence. A terminal
    status seals the run and keeps its guard active for the remainder
    of the current turn. The extension deactivates it on the next
    direct user turn or session startup.

## Rules

- Do not bypass the outer policy. Do not edit outside the active
  scaffold without first recording an authorized amendment.
- Do not create a replacement harness merely to commit or push
  already-reviewed changes or to escape a completed run's guard. The
  harness is control state, not a worktree. Use `/harness clear` only
  to abandon a non-terminal run.
- Do not weaken tests, fake outputs, or bypass validation.
- An enforcement block is a harness mismatch, not a platform-policy
  refusal. Amend the scaffold when authorized; otherwise ask the user.
  Mark failed only when the task cannot proceed.
- If validation fails after one focused fix attempt, escalate.
- If team mode is unavailable, run the harness directly in the current
  session and say that no teammate was spawned.
- Keep the final report to changed files, validation evidence, team
  status/results, and remaining risks.
