# Team Mode comparison matrix

This is a release-status matrix for the experimental
persistent-runtime direction as of 2026-07-10. “Target” is design
intent, not shipped behavior. A capability moves to “release evidence”
only after the corresponding automated and dogfood gates in the
[release checklist](./release-checklist.md) pass.

## Status

| Capability           | Current package foundation                                                                                           | Persistent-runtime target                                                                          | Evidence required before release                                                                |
| -------------------- | -------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| Session model        | Visible Pi session files plus local session registration and wake-up processes.                                      | One long-lived owning Pi process per teammate session and stable session id.                       | A: readiness, three native outcomes, stable ids, one owner per session.                         |
| Native turns         | Initial instructions and wake turns are recorded in Pi session history.                                              | Prompt, steer, and follow-up are native turns on the same runtime.                                 | A/B: native history and structured completion/failure, not mailbox rows alone.                  |
| Interactive resume   | `/resume` can open a session file as another process. It does **not** attach to a running owner.                     | Safe attach/detach to the owning runtime without replacing it.                                     | B: unchanged owner identity/PID and one JSONL writer. Blocked until upstream Pi exposes attach. |
| Coordination         | Global local SQLite sessions, groups, artifacts, messages, and receipt fields; HTTP/SSE hints with polling fallback. | Outcome-based delivery with monotonic durable receipts and idempotent recovery.                    | D: concurrent delivery, crash/restart, exactly-once recovery, timeout/cancel, malformed input.  |
| Recursive teams      | Any registered session can coordinate or report to another session.                                                  | Lead-to-lead-to-worker trees with explicit depth and concurrency limits.                           | C: nested routing, closure behavior, graph/status, enforced limits.                             |
| Workspace isolation  | Sessions record a cwd; independently started peers may share it. No managed worktree guarantee.                      | Explicit collision rejection or deliberate workspace isolation.                                    | E: deterministic collision/isolation evidence.                                                  |
| Environment boundary | No release claim for a teammate environment allowlist. Shell commands inherit normal process trust boundaries.       | Minimal child environment plus explicit allowlist; bounded/redacted diagnostics.                   | E: non-secret sentinel excluded and allowlisted variables preserved.                            |
| Sender identity      | Session ids and aliases address peers over the coordination bus.                                                     | Caller-bound sender identity with unknown-field rejection.                                         | E: spoofed sender and malformed fields rejected.                                                |
| Failure recovery     | SQLite state and session history survive process exits; current wake behavior is transitional.                       | Lease/start identity checks, durable pending work, restart on the same session, one active writer. | D plus adversarial fault injection at each lifecycle milestone.                                 |
| Packaging            | Package publishes `dist`, docs, and README.                                                                          | Every build starts from an empty `dist`; clean and stale-seeded packs are identical.               | `test:pack`: equal tar lists and no forbidden removed runtime paths.                            |
| Hosted execution     | Local-only.                                                                                                          | Local-only.                                                                                        | Explicit non-goal.                                                                              |
| Git/PR automation    | No automatic push or PR creation.                                                                                    | No automatic push or PR creation.                                                                  | Explicit non-goal.                                                                              |

## Comparison with common alternatives

- Pi Team Mode is a local coordination extension, not a hosted task
  service or general workflow engine.
- Unlike a terminal multiplexer, it provides SQLite-backed identities,
  groups, artifacts, and mailboxes. It does not claim terminal,
  worktree, or OS-level sandbox supervision.
- Unlike prompt-only subagents, the persistent-runtime target keeps a
  native Pi session as the durable teammate history. The release gate
  requires process and transcript evidence, not merely a successful
  send action.
- Strong sandboxing belongs to a project harness, container, or OS
  boundary. Team Mode's target environment filtering is defense in
  depth, not a shell sandbox.

## Known limitation and non-goals

Upstream Pi currently has no supported way for `/resume` to attach an
interactive TUI to an already-running process. Starting another
process against the same session would create competing
owners/writers, so live attach remains unavailable until that upstream
primitive exists.

The persistent-runtime work does not target cloud-hosted execution,
CrewAI-style general graph workflows, automatic pushes/PRs, or a
replacement for single-session pair-programming tools.
