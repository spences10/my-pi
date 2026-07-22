---
name: software-factory
# prettier-ignore
description: Use when explicitly evaluating or recovering the paused Pi Factory v1 control plane; do not route normal repository work through it.
compatibility: Requires Pi with the @spences10/pi-factory extension.
---

# Software Factory

Factory v1 is paused. Do not invoke it for normal repository work,
including ambiguous, high-risk, coordinated, or review-gated delivery.
Use it only when the user explicitly requests Factory v1 evaluation or
recovery of an existing workflow. Prefer `pi-harness` for bounded task
contracts and Team Mode for peer coordination.

When explicitly evaluating Factory v1, retain its approval nodes; a
requested side effect is not itself a factory approval decision.

1. Preview with `factory action=preview`; explain workflow/version,
   policy sources, compute, parallelism, validations, retry limits,
   review mode, ownership, and approvals.
2. Accept an explicit override only with a reason. Overrides cannot
   lower runtime safety.
3. For external work, use `intake-preview` with a trusted project
   mapping and explicit overrides, inspect the explained route, then
   use `intake-apply` to bind lifecycle updates to one workflow.
4. Create direct work once with `factory action=create`; this
   atomically claims paths and creates the real harness. Supply
   `harness_dir` only to adopt an exactly compatible existing harness;
   incompatible or duplicate harnesses are rejected.
5. Use `factory action=operate` to automatically progress eligible
   owned RPC planning, execution, validation, and structured review.
   Bounded parallel diagnosis must establish an observable workspace
   baseline before launch and has no mutation scope. Promote only
   exactly completed, structured, zero-change results before the
   single mutating owner proceeds. The operator stops at human
   approval. Use `execution_mode=peer` only as an explicit operator
   handoff.
6. Let validation and reviewer failures use the integrated outbox. Use
   `flush-feedback` only to retry failed delivery; retries remain
   bounded by node policy.
7. Create review packets only after deterministic validation.
   Reviewers record an initial opinion before executor narrative is
   revealed.
8. Never infer human approval. Record the actor, action, scope,
   decision, and evidence.
9. Transfer mutation with `request-transfer`, then have the named
   recipient use `acknowledge-transfer`; the old claim remains active
   until acknowledgement. Never mutate through an advisory conflict.
10. On interruption, inspect concise `status` (`full=true` adds
    machine state). Pause/resume/cancel only when capabilities report
    support; use the public lifecycle actions so the owned process and
    durable record agree. Timeout and cancellation must become durable
    terminal records. Resume only an owned recoverable adapter;
    missing process or recovery support is `lost`. Peer sessions do
    not continue between turns and require operator/user continuation.
11. Record one explicit terminal outcome. `completed` requires the
    authoritative completion, validation, review, and approval chain;
    use `superseded` or `completed-outside-factory` with explicit
    replacement/external evidence instead of inventing success.
12. Use comparative metrics only for measured, correlated runs with
    one provider/model/reasoning tuple, session, valid duration,
    telemetry or usage for every current-contract attempt, matching
    role/node kind, and one completed non-read-only authoritative
    attempt per executed node. Hypotheses and retries cannot mask
    missing correlation. Exclude synthetic or uncorrelated dogfood and
    refuse recommendations when calibration reports exclusions.
13. Define calibration through a versioned suite with exact
    project/policy/route/compute/gate/retry pins and explicit
    thresholds. Derive available import pins from durable state and
    use named embedding authentication for unavailable pins; never
    copy target-case values into provenance. Store/query/export total
    and excluded rows separately, but count only complete,
    non-conflicting outcomes with accepted provenance and measured
    correlation toward coverage and evidence proposals. Keep baseline
    status blocked until every workflow meets eligible coverage. Never
    generalize a single-project finding.
14. Finish with `metrics`, validation evidence, and remaining risks.
