# Team mode comparison matrix

This matrix is a practical gap check, not a positioning exercise. It
compares `pi-team-mode` against common orchestration patterns as of
2026-05-01.

## Sources checked

- Claude Code subagents / Agent SDK: context isolation, parallel
  subagents, tool restrictions, resumable subagent transcripts, and no
  nested subagents.
- OpenAI Codex CLI / Cloud: local repo editing, subagents, Cloud
  tasks, approval modes, sandboxing, MCP, and applying cloud diffs
  locally.
- CrewAI: agents, crews, flows, guardrails, memory, knowledge,
  observability, sequential/hierarchical/hybrid processes, callbacks,
  and HITL triggers.
- Microsoft Agent Framework / AutoGen successor: session state,
  middleware, telemetry, MCP clients, graph workflows, checkpointing,
  and HITL support.
- aider: terminal pair-programming, repo map, chat commands, lint/test
  loops, broad model support, and tight git integration.
- tmux / claude-squad-style local runners: multiple terminal sessions,
  worktrees, status detection, switching, and PR-oriented workflows.

## Matrix

| Capability               | pi-team-mode                                                                                                  | Claude Code subagents                                                             | Codex CLI/Cloud                                                                           | CrewAI / Agent Framework                                                 | aider                                                                                              | tmux local runners                                         |
| ------------------------ | ------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| Context isolation        | Separate RPC Pi sessions with separate transcripts.                                                           | Fresh subagent conversations; parent receives final result.                       | Separate CLI/cloud agent sessions.                                                        | Per-agent/session state and workflow state.                              | Single main chat unless user starts separate sessions.                                             | Separate terminal processes.                               |
| Workspace isolation      | Shared cwd or managed git worktrees; collision guards for mutating work.                                      | Same project workspace; tool restrictions reduce risk but do not imply worktrees. | Local sandbox/approval modes and cloud task environments.                                 | App-defined; can integrate sandboxes but not inherently repo worktrees.  | Edits local repo directly; git helps review/undo.                                                  | Strong if each pane uses a worktree; usually user-managed. |
| Process supervision      | Spawn, wait, shutdown, orphan detection, PID identity checks, startup-failure handling.                       | SDK manages subagent lifecycle inside the parent run.                             | Product-managed for cloud; CLI manages local session.                                     | Framework runtime manages workflows, not local terminal child processes. | Single process; no multi-agent supervision focus.                                                  | tmux supervises panes but semantic health is heuristic.    |
| Task lifecycle           | Durable create/claim/assign/block/cancel/reopen/complete with dependency checks and concurrent claim locking. | Prompt-level delegation; no durable local task board.                             | Cloud tasks have product task lifecycle; CLI is prompt/session oriented.                  | First-class tasks/processes/workflows with callbacks/guardrails.         | Chat/task convention, not durable team task lifecycle.                                             | Usually ad-hoc session names/branches.                     |
| Steering                 | Prompt, follow-up, steer, wait, shutdown, DM.                                                                 | Parent can invoke/resume subagents; not an operator mailbox.                      | Interactive CLI and Cloud task review/apply flow.                                         | Workflow/HITL hooks and callbacks.                                       | Interactive chat commands.                                                                         | Direct pane interaction.                                   |
| Mailbox semantics        | Durable delivered/read/ack states with partial message IDs and redelivery if unacknowledged.                  | No equivalent durable mailbox.                                                    | Product notifications/review flow, not a local mailbox protocol.                          | App-defined messaging possible.                                          | No mailbox.                                                                                        | No mailbox beyond terminal text.                           |
| Observability            | Status/dashboard/results, transcripts, usage summaries, events JSONL, UI status widget.                       | Subagent transcripts and SDK message stream.                                      | CLI UI, Cloud task details, review/diff surfaces.                                         | Telemetry and observability are core framework concepts.                 | Chat transcript, git diff, lint/test output.                                                       | Pane status heuristics and previews.                       |
| Permissions / sandboxing | Child environment allowlist, profile tool/skill restrictions, no nested teammate spawn, worktree guards.      | Tool restrictions, permission modes, no nested subagents.                         | Approval modes, sandboxing, MCP controls.                                                 | Guardrails, middleware, type-safe workflow boundaries.                   | User-controlled repo/files; supports model/provider config but less orchestration guardrail focus. | Shell permissions unless wrapped by external sandboxing.   |
| Git / PR workflow        | Worktree branch assignment; no built-in PR creation/review workflow.                                          | Depends on tools available to parent/subagent.                                    | Cloud/app workflows center on diffs and review/apply; GitHub issue/PR integrations exist. | App-defined.                                                             | Strong git integration and auto-commit behavior.                                                   | Often strong via worktrees and `gh`, but tool-specific.    |
| Failure recovery         | Stale locks, corrupt state quarantine, orphan recovery, delivery redelivery, child death blocks tasks.        | SDK/session recovery through resume; less local process recovery exposed.         | Cloud product handles task failures; local CLI handles session errors.                    | Checkpointing/state/HITL available in framework workflows.               | Git undo and retry; limited multi-agent failure semantics.                                         | tmux keeps panes alive; recovery is manual.                |
| Docs honesty             | README documents guarantees, command/API surface, env limits, and local-state behavior.                       | Official docs document subagent inheritance, restrictions, and troubleshooting.   | Official docs cover CLI, Cloud, sandbox/approval concepts.                                | Official docs cover capabilities and framework fit.                      | Official docs are clear about pair-programming model.                                              | READMEs document status heuristics and session model.      |

## Gaps and decisions

### Closed by linked issues

- Mailbox read/ack ambiguity and partial acknowledgement: covered by
  issue #48.
- Adversarial deterministic reliability coverage: covered by issue
  #49.
- This comparison matrix and gap ledger: covered by issue #50.

### Explicit non-goals for this epic

- Cloud-hosted task execution. Team mode is local-first; Codex
  Cloud-style hosted workers would be a separate product direction.
- Full workflow-engine parity with CrewAI or Microsoft Agent
  Framework. Team mode should coordinate coding sessions, not become a
  general graph workflow runtime.
- Auto-opening PRs or auto-pushing branches. Worktree/branch metadata
  is tracked, but publishing code should remain an explicit
  user/project workflow.
- Shell sandboxing beyond child environment filtering and workspace
  isolation. Strong OS/container sandboxes should be supplied by the
  harness or project.
- Replacing pair-programming tools like aider. Team mode complements
  single-agent coding loops by supervising multiple Pi sessions.

### Future candidates outside the epic

- Optional PR helper command that summarizes completed task results
  and prepares a `gh pr create` draft without pushing automatically.
- Optional per-profile permission presets that map to Pi tool
  selections more visibly in the dashboard.
- Exportable team run report combining events, task results, usage,
  and branch metadata for post-run review.
