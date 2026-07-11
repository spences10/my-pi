# Team Mode comparison matrix

This is a release-status matrix for the opt-in persistent runtime as
of 2026-07-10. “Target” describes the remaining release contract, not
shipped stable behavior. Enable the current implementation with
`MY_PI_TEAM_RUNTIME=persistent`. A capability moves to “release
evidence” only after the corresponding automated and dogfood gates in
the [release checklist](./release-checklist.md) pass.

## Status

| Capability           | Current opt-in implementation                                                                                                    | Remaining release target                                                      | Evidence required before default release                                                  |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Session model        | One detached SDK host owns each persistent teammate session; SQLite tracks generation, lease, PID identity, and lifecycle state. | Prove stable ownership across crash, restart, shutdown, and normal dogfood.   | A/D: readiness, stable ids, one owner, recovery, and structured outcomes.                 |
| Native turns         | Spawn waits for prompt preflight; live sends route as native prompt, steer, or follow-up turns on the owner.                     | Durable read/ack milestones and idempotent crash recovery.                    | A/B/D: native history and receipt transitions, not mailbox rows alone.                    |
| Interactive resume   | `/resume` opens another process; it does **not** attach to the running owner.                                                    | Safe attach/detach to the owner without replacing it.                         | B: unchanged owner identity/PID and one writer. Blocked until upstream Pi exposes attach. |
| Coordination         | SQLite sessions/groups/artifacts/messages plus native persistent delivery; accepted delivery advances only `delivered_at`.       | Crash-safe ordering, deduplication, read, acknowledgement, and recovery.      | D: concurrent delivery, crash/restart, timeout/cancel, malformed input, duplicate checks. |
| Recursive teams      | The exact Team Mode extension loads in each host; report recipients and nested-spawn routing are injected.                       | Explicit depth, concurrency, resource, and shutdown/cascade limits.           | C: nested routing, closure behavior, graph/status, enforced limits.                       |
| Workspace isolation  | Every spawn explicitly selects shared cwd or a caller-provided isolated directory; active isolated-path collisions reject.       | Prove policy across persistent recovery and atomic concurrent claims.         | E: shared acknowledgement, dirty/non-Git support, and collision dogfood.                  |
| Environment boundary | Runtime/wake/command children receive a minimal environment with explicit allowlists; command diagnostics are bounded/redacted.  | Prove supported provider and observability configurations across installs.    | E: sentinel excluded, allowlisted variables preserved, diagnostics bounded/redacted.      |
| Sender identity      | Tool sends and receipt actions are caller-bound; unknown and action-inapplicable fields reject.                                  | Preserve compatibility only where identity remains unambiguous.               | E: spoofed sender, cross-inbox mutation, and malformed fields rejected.                   |
| Failure recovery     | Runtime ownership uses leases and process-start identity; terminal owners can restart the same session generation safely.        | Exactly-once pending-delivery recovery and adversarial process/storage proof. | D plus fault injection at every lifecycle milestone.                                      |
| Packaging            | Builds clean `dist`; `test:pack` compares clean/stale-seeded tar lists and rejects obsolete paths.                               | Clean user install and published sandbox evidence.                            | Pack smoke plus installed and published artifact checks.                                  |
| Hosted execution     | Local-only.                                                                                                                      | Local-only.                                                                   | Explicit non-goal.                                                                        |
| Git/PR automation    | No automatic push or PR creation.                                                                                                | No automatic push or PR creation.                                             | Explicit non-goal.                                                                        |

## Comparison with common alternatives

- Pi Team Mode is a local coordination extension, not a hosted task
  service or general workflow engine.
- Unlike a terminal multiplexer, it provides SQLite-backed identities,
  groups, artifacts, and mailboxes. It does not claim terminal,
  worktree, or OS-level sandbox supervision.
- Unlike prompt-only subagents, the persistent runtime keeps a native
  Pi session as the durable teammate history. The release gate
  requires process and transcript evidence, not merely a successful
  send action.
- Strong sandboxing belongs to a project harness, container, or OS
  boundary. Team Mode's environment filtering is defense in depth, not
  a shell sandbox.

## Known limitation and non-goals

Upstream Pi currently has no supported way for `/resume` to attach an
interactive TUI to an already-running process. Starting another
process against the same session would create competing
owners/writers, so live attach remains unavailable until that upstream
primitive exists.

The persistent-runtime work does not target cloud-hosted execution,
CrewAI-style general graph workflows, automatic pushes/PRs, or a
replacement for single-session pair-programming tools.
