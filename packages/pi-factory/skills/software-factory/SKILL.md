---
name: software-factory
# prettier-ignore
description: Use when dispatching or operating governed software work through the Pi factory control plane, including route preview, retries, review, approvals, recovery, or metrics.
compatibility: Requires Pi with the @spences10/pi-factory extension.
---

# Software Factory

1. Preview with `factory action=preview`; explain workflow/version,
   policy sources, compute, parallelism, validations, retry limits,
   review mode, ownership, and approvals.
2. Accept an explicit override only with a reason. Overrides cannot
   lower runtime safety.
3. Create once with `factory action=create`; this atomically claims
   paths and creates the real harness. Do not create a second harness.
4. Operate nodes in dependency order. Record tool-gate evidence, then
   use `run-validation`; never complete validation generically.
5. Let validation and reviewer failures use the integrated outbox. Use
   `flush-feedback` only to retry failed delivery; retries remain
   bounded by node policy.
6. Create review packets only after deterministic validation.
   Reviewers record an initial opinion before executor narrative is
   revealed.
7. Never infer human approval. Record the actor, action, scope,
   decision, and evidence.
8. On interruption, inspect persisted state and resume valid nodes; do
   not repeat completed research. Escalate stale owners because Team
   Mode does not supervise sessions.
9. Finish with `metrics`, validation evidence, and remaining risks.
