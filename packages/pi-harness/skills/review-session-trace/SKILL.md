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

1. Locate the evidence. `/session` prints the current session file;
   saved sessions are JSONL under `~/.pi/agent/sessions/` unless a
   session directory is configured. For harness work, also read
   `harness.json`, `status.json`, `logs/` and `OUTCOME.md` in the
   harness directory.
2. Read the session entries in order: tool calls, tool results,
   errors, retries and user corrections.
3. Separate three outcomes: the task succeeded, validation passed, or
   the result is unknown. A finished conversation or a passed check
   does not prove the task succeeded.
4. Look for hidden failures and wasted work: failed tool calls the
   agent worked around, repeated exploration, stale or wrong
   instructions, and checks that did not cover the task.
5. Propose focused improvements to instructions, skills or tooling for
   the next run. If the evidence does not support a change, say so.

Report as Markdown. Cite session entry IDs or artifact paths for each
finding. Do not apply the proposed improvements; the user decides
which to take.
