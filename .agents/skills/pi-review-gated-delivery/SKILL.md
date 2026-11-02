---
name: pi-review-gated-delivery
# prettier-ignore
description: Use when coordinating review-gated delivery of discrete GitHub issues between one implementation peer and a review-only lead, with user-authorized Changesets and commits.
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
- Create Changesets and commit only when the user explicitly requests
  the respective action; review approval alone grants neither.

## Delivery Loop

1. Use `team session_list`; verify the requested peer and repository.
2. Send one complete issue contract: scope, acceptance criteria,
   constraints, validation, commit/Changeset authorization (none by
   default), and next-task boundary.
3. Require completion before reporting: no checkpoints or arbitrary
   slices. Permit early escalation only for a genuine blocker,
   contradiction, unsafe scope change, or missing authority.
4. Require one final artifact with acceptance mapping, changed files,
   exact validation, diff summary, and remaining risks.
5. Review independently without editing. Return `approve` or
   `changes-requested` with prioritized findings and exact evidence.
6. Repeat implementation and review until approved; never infer
   approval from tests, delivery, silence, or model output.
7. After review approval, create a Changeset or commit only if the
   user explicitly requested that action. Reuse passed validation if
   inputs are unchanged; rerun only checks affected by new edits.
8. Close the issue only when authorized by the user. Confirm a clean
   tree before assigning the next dependency-ordered issue.

## Messaging

Read the "Agent send recipes" section of
`packages/pi-team-mode/README.md` from the repository root.

- Send issue contracts, blockers, final artifact handoffs, and review
  decisions as `message_type: action`; they need the peer to act.
- Give each distinct send an `idempotency_key` tied to the issue and
  handoff/review revision. Retry unchanged sends with the same key;
  changed content, options, or recipients require a new key.
- If a useful FYI is warranted, use `message_type: status` and a
  stable task/topic `status_key`. Give changed updates new retry keys.
  Status cannot be urgent or require acknowledgement; it is not a
  substitute for the final actionable handoff or permission to add
  progress checkpoints to the delivery loop.
- Use `session_read` after review and `session_ack` after processing,
  with the received `message_ids`. Do not echo handoffs, send
  acknowledgement-only replies, or repeatedly send unchanged status.

## Boundaries

- Do not start parallel mutation in a shared working tree.
- Do not treat mailbox delivery as liveness or continued execution.
- If a peer stops, report the limitation and ask the user to resume or
  open a session; never simulate supervision.
- Use a worktree and a separate contract if parallel mutation becomes
  necessary.
