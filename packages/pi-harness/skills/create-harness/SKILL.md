---
name: create-harness
# prettier-ignore
description: Use when the user requests a task harness or a concrete execution contract adds value for risky work. Creates task scaffolding directly; assessment is optional.
compatibility: Requires Pi with the pi-harness extension enabled.
---

# Create a Task Harness

Use direct work for routine changes. Do not introduce a harness just
to satisfy process, or expand a candidate idea into a larger project.

1. Recover the user's task, repository conventions and acceptance
   checks.
2. Call `harness_create` with the task and non-empty validation
   commands. Add `allowed_paths` when a scope narrower than the
   project is useful. Normal source and test development are allowed
   by default.
3. Read the resulting contract and use the `execute-harness` skill.

No separate assessment or approval roundtrip is required to create the
scaffold. If the need or architecture is genuinely uncertain, optional
`harness_assess` can record investigation and a recommendation without
locking tools. It is not a read-only security mode.

Creation does not authorize commits, pushes, releases, destructive
operations or scope outside the user's request. A broader accepted
contract needs user authorization, not an executor's self-amendment.
