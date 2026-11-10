---
name: create-repeatable-task
# prettier-ignore
description: Use when the user wants a task saved so it can be run again, such as a recurring check, review or maintenance job. Writes it as a project skill that runs through a harness and ends with a session trace review.
compatibility: Requires Pi with the pi-harness extension enabled.
---

# Create a Repeatable Task

Save the task as a project skill. Do not build a runner, a config
format or a script for it.

1. Recover the task from the user: what it does, what it may change or
   whether it is read-only, and the commands that prove the result.
   `harness_create` needs at least one validation command. If none
   exists, ask; do not invent a check that cannot fail.
2. Write `.agents/skills/<name>/SKILL.md` in the project. Use a
   lowercase hyphenated name and a single-line description starting
   `Use when...`. The body holds:
   - the task instructions, including what must not change;
   - the validation commands, verbatim;
   - `allowed_paths`, when the task needs a scope narrower than the
     project;
   - a stable telemetry identity: `eval_suite: repeatable-task` and
     `eval_case_id: <skill-name>`;
   - the run steps below.
3. Give the saved skill these run steps:
   1. If a `telemetry` tool is available, call `action: on` with the
      saved suite and case identity. Retain the returned run ID and
      session path. If it was already on or an override prevented
      activation, do not claim a new task recording or turn it off.
   2. Call `harness_create` with the task, validation commands and any
      saved `allowed_paths`. Retain its artifact directory.
   3. Follow the `execute-harness` skill. Record the task's start and
      end session entry IDs, including failures and user corrections.
   4. If step 1 turned recording on, call `action: off` after
      execution and validation, including when they fail. End this
      tool turn: recording stops at Pi's `turn_end`. Do not batch the
      review or its query into the same turn or codemode script.
   5. In the next turn, follow `review-session-trace` with the task
      identity, session path, entry boundaries and harness directory.
      Compare only closed recordings for the same task. If existing
      user recording is still open, mark current metrics provisional
      and use the trace and validation artifacts for this review.
   6. Report the result, the validation status and the review
      findings. A passed check or a closed recording is not proof the
      task succeeded.
4. Tell the user how to run it: `/reload`, then ask for the task by
   name or use `/skill:<name>`.

To change the task later, edit its skill file. Review findings are
proposals; apply one only when the user asks.

Saving a task does not authorize commits, pushes, releases or
destructive operations when it runs.
