---
name: pi-review-gated-delivery
# prettier-ignore
description: Use when coordinating review-gated delivery of discrete GitHub issues between one implementation peer and a review-only lead, with user-owned Changesets and approval-gated commits.
compatibility:
  Requires Pi Team Mode and a user-opened peer session in the same
  repository.
---

# Review-Gated Peer Delivery

Compose Team Mode, repository validation, and explicit human approval;
do not claim peer process supervision.

## Roles

- Keep the lead session review-only after delegation.
- Give one implementation session sole mutating ownership of one
  issue.
- Reserve Changeset creation and consequential approval for the user.

## Delivery Loop

1. Use `team session_list`; verify the requested peer and repository.
2. Send one complete issue contract: scope, acceptance criteria,
   constraints, validation, no commit/Changeset, and next-task
   boundary.
3. Require completion before reporting: no checkpoints or arbitrary
   slices. Permit early escalation only for a genuine blocker,
   contradiction, unsafe scope change, or missing authority.
4. Require one final artifact with acceptance mapping, changed files,
   exact validation, diff summary, and remaining risks.
5. Review independently without editing. Return `approve` or
   `changes-requested` with prioritized findings and exact evidence.
6. Repeat implementation and review until approved; never infer
   approval from tests, delivery, silence, or model output.
7. After approval, let the user create the Changeset. Commit only
   after explicit user authorization and a clean final validation
   pass.
8. Close the issue, confirm a clean tree, then assign only the next
   dependency-ordered issue.

## Boundaries

- Do not start parallel mutation in a shared working tree.
- Do not treat mailbox delivery as liveness or continued execution.
- If a peer stops, report the limitation and ask the user to resume or
  open a session; never simulate supervision.
- Use a worktree and a separate contract if parallel mutation becomes
  necessary.
