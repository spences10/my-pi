---
name: execute-harness
# prettier-ignore
description: Use when running an existing /tmp Pi task harness. Executes inside the active contract, records status, respects enforcement, and loops through validation.
compatibility:
  Requires my-pi or Pi with the pi-harness extension tools enabled.
---

# Execute Harness

Run the task through an existing my-pi harness. The harness is the
execution contract.

## Workflow

1. Resolve the harness directory from the user request or active
   harness context.
2. Read `harness.json`, `SYSTEM.md`, `TASK.md`, and `status.json`
   before editing.
3. Call `harness_update` with `status: running` and the current phase.
4. If the `team` tool is available and you are the team lead, create
   or reuse a team, create/claim a task for the harness, and use
   `member_spawn` with `workspace_mode: worktree` and `mutating: true`
   to run one executor teammate against the harness.
5. The teammate prompt must tell it to read `harness.json`,
   `SYSTEM.md`, `TASK.md`, and `status.json`, execute only inside the
   contract, run `validate.sh` and `review.sh`, update harness
   evidence, and report changed files plus risks.
6. Recover any remaining source-of-truth context needed to act safely.
7. Execute surgically inside `allowed_paths`; do not fight
   enforcement.
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
    rule applies; otherwise mark `failed` with evidence.

## Rules

- Do not edit outside the harness contract.
- Do not weaken tests, fake outputs, or bypass validation.
- If enforcement blocks an action, update the harness as failed or ask
  for a planner/user amendment.
- If validation fails after one focused fix attempt, escalate.
- If team mode is unavailable, run the harness directly in the current
  session and say that no teammate was spawned.
- Keep the final report to changed files, validation evidence, team
  status/results, and remaining risks.
