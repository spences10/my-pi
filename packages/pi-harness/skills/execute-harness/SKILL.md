---
name: execute-harness
# prettier-ignore
description: Use when executing an existing Pi task harness. Works inside accepted scope, records progress, and requests evidence-backed completion with normal fix-and-retry loops.
compatibility: Requires Pi with the pi-harness extension enabled.
---

# Execute a Task Harness

1. Read the harness contract and task. Recover project context.
2. Record progress with `harness_update`. Work directly unless the
   user has authorized collaboration with existing Team Mode peers.
3. Implement inside the accepted maximum scope. Normal project test
   development is allowed unless explicitly excluded. Do not weaken
   tests or fake outputs to manufacture success.
4. Use `harness_amend` for strategy changes. Accepted checks cannot be
   removed, and scaffold scope never grants a larger accepted
   boundary.
5. Inspect and run checks as useful during development. Fix ordinary
   failures and retry; no arbitrary single-fix escalation applies.
6. Request `harness_update` with `status: completed`. It reruns
   accepted checks and drift review through normal tool hooks, stores
   outputs, and only records completion for a stable passing artifact.
7. Read `OUTCOME.md` or `outcome.json`, inspect the diff and report
   actual validation, unresolved risks and any review still needed.

A failed or interrupted completion attempt is not success. Fix the
cause or ask for genuinely missing authority. A changed artifact must
be checked again. Manual evidence strings are notes, not proof.

The harness is temporary workflow state, not an OS sandbox, worktree,
worker supervisor or a substitute for independent review. Team Mode
cannot spawn workers. Commits and external effects still require their
own user authorization. Completed runs are sealed; do not create a new
harness merely to commit their reviewed changes.
