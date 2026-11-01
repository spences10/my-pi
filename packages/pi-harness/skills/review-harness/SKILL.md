---
name: review-harness
# prettier-ignore
description: Use when reviewing work performed through a Pi task harness. Checks accepted scope, executed validation records, final artifacts and remaining risks without trusting self-reported completion notes.
compatibility: Requires Pi with the pi-harness extension enabled.
---

# Review Harness Work

1. Read `harness.json`, task, status, amendment history and outcome.
2. Inspect the actual diff in the execution workspace. Run `review.sh`
   there or set `HARNESS_CWD` for a linked worktree.
3. Confirm the final changes respect accepted maximum scope and
   explicit exclusions. Strategy amendments must not grant wider
   authority.
4. Inspect executed validation records and referenced output, not just
   manual evidence strings. Check that accepted validators were
   retained, failures were handled honestly, and the reviewed artifact
   is current.
5. Check for weakened tests, fake outputs, missed user-facing
   behaviour, and approvals still required for external effects.

Report pass, needs fix, or needs a user decision, with concrete
findings, validation run or reused, and remaining risks. A passing
runtime check is not an independent semantic review or an OS security
guarantee.
