---
name: review-session-trace
# prettier-ignore
description: Use when the user asks for a retrospective on finished agent work. Reads the saved session trace and any harness artifacts for hidden failures and wasted effort, then proposes focused improvements without applying them.
compatibility:
  Requires Pi session files. Harness artifacts are optional.
---

# Review a Session Trace

Review what the agent actually did, not its final summary. This is
read-only: do not edit files or rerun the task.

1. Locate the evidence for the requested task: session path, start and
   end entry IDs, and task identity. Reuse the path returned by
   telemetry when available. Otherwise use supplied session metadata
   or ask the user for the path shown by `/session`; an agent cannot
   invoke that slash command through Bash. Do not guess by choosing
   the newest file. Respect configured session directories and note
   when an ephemeral session has no saved trace. For harness work,
   also read `harness.json`, `status.json`, `logs/` and `OUTCOME.md`.
2. Pi session entries form a tree. Identify the task's start and end
   entries, follow `parentId` backwards from the end to the start,
   then read that path chronologically. Include tool calls, nested
   call records, tool results, errors, retries and user corrections.
   Do not treat JSONL file order as one conversation or include other
   tasks merely because they share the file. Review relevant abandoned
   attempts separately, naming their branch and entry IDs rather than
   merging them into the selected branch.
3. Separate three outcomes: the task succeeded, validation passed, or
   the result is unknown. A finished conversation or a passed check
   does not prove the task succeeded.
4. Look for hidden failures and wasted work: failed tool calls the
   agent worked around, repeated exploration, stale or wrong
   instructions, and checks that did not cover the task.
5. If a `telemetry` tool and a task identity are available, query by
   `cwd`, `eval_suite` and `eval_case_id`. Match this recording using
   its run ID and session path, not just the newest result. Compare
   only records with non-null `ended_at` and duration; an
   `active_run_id`, `stop_pending` flag or unfinished record is not a
   completed baseline. A normal recording stop can leave `success`
   unknown: use the harness evidence to assess task success. Verify
   comparable instructions, scope and models before claiming an
   improvement. Same-project activity alone is not comparable. If
   identity, closed recordings or sufficient evidence are missing,
   skip the metric comparison and state the gap; still review the
   trace. Do not change recording state during this read-only review.
6. Propose focused improvements to instructions, skills or tooling for
   the next run. If the evidence does not support a change, say so.

Report as Markdown. Cite session entry IDs or artifact paths for each
finding. Do not apply the proposed improvements; the user decides
which to take.
