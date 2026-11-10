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
   - the run steps below.
3. Give the saved skill these run steps:
   1. Call `harness_create` with the task and the validation commands.
   2. Follow the `execute-harness` skill to completion.
   3. Follow the `review-session-trace` skill on this run.
   4. Report the result, the validation status and the review
      findings. A passed check is not proof the task succeeded.
4. Tell the user how to run it: `/reload`, then ask for the task by
   name or use `/skill:<name>`.

To change the task later, edit its skill file. Review findings are
proposals; apply one only when the user asks.

Saving a task does not authorize commits, pushes, releases or
destructive operations when it runs.
