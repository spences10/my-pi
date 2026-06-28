---
name: review-harness
# prettier-ignore
description: Use when reviewing implementation work that ran through a /tmp Pi task harness. Checks contract drift, unsafe shortcuts, validation evidence, and status honesty.
compatibility:
  Requires my-pi or Pi with the pi-harness extension tools enabled.
---

# Review Harness

Review the completed or failed work against the harness contract.

## Workflow

1. Resolve the harness directory and read `harness.json`, `TASK.md`,
   `status.json`, `OUTCOME.md` or `outcome.json`, and
   `logs/events.jsonl` if present.
2. Run or inspect `<harness_dir>/review.sh`.
3. Inspect git diff and changed files.
4. Compare changes against `allowed_paths`, `forbidden_paths`,
   test-change policy, and escalation rules.
5. Verify validation evidence from `status.json`, logs, and command
   output.
6. Decide: pass, needs executor fix, or escalate to planner/user.

## Review Checks

- Did work stay inside allowed paths?
- Were tests changed when `allow_test_changes` is false?
- Were validators weakened, deleted, skipped, or bypassed?
- Were outputs faked or hardcoded to satisfy checks?
- Are status and evidence entries honest and complete?
- Does the outcome artifact include changed files, validation
  evidence, team status, and remaining risks?
- Did the executor make unapproved architecture decisions?

## Output Shape

```md
## Verdict

Pass | Needs executor fix | Escalate

## Findings

- P0/P1/P2: <issue> — `<path>` — <required action>

## Validation Evidence

- `<command>` — pass/fail/not run — <evidence>

## Required Next Step

- <one action>
```
