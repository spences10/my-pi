# @spences10/pi-factory

Reusable software-factory control plane for Pi. It composes existing
harness, peer coordination, trust, telemetry, and observability
primitives into versioned, inspectable workflows; it does not spawn or
supervise sessions and does not create another telemetry database.

## Install

```bash
pi install npm:@spences10/pi-factory
```

## Operating model

```text
intake → explained route → harness contract → execute → validate/retry
       → independent review → explicit approval → outcome/metrics
```

Use `/factory preview <task>` before `/factory start <task>`. The
`factory` tool exposes the same routing and state-machine semantics to
TUI, print/JSON, RPC, and SDK consumers. Intake risk hints may only
raise the catalog/policy risk; lower hints are audited and ignored.
Urgent intake raises minimum risk to `high`, caps stall escalation at
five minutes, and records that decision in route rationale.
Programmatic consumers may import `dispatch_task`,
`create_factory_state`, node operations, and `derive_factory_metrics`.

The catalog includes materially distinct `chore`, `feature`,
`ambiguous-bug`, `ui-copy`, `database-migration`, `incident`,
`architecture`, and `safe-release` workflows. Definitions select
capability/reasoning roles rather than requiring a provider. One
mutating owner is retained even where read-only hypotheses/research
run in parallel.

## Repository policy

A trusted project may provide `.pi/factory.json`:

```json
{
	"schema_version": 1,
	"policy_id": "project@1",
	"risky_paths": ["migrations/**"],
	"required_approvals": ["public-contract"],
	"max_parallelism": 2,
	"workflow_overrides": {
		"feature": {
			"validation_commands": ["pnpm test"],
			"retry_limit": 1
		}
	}
}
```

Precedence is runtime catalog → trusted repository strengthening →
audited human route override. Unknown schema versions and attempts to
lower risk fail closed. Repository policy may add validation/approval
requirements, cap parallelism/retries, or raise risk; it cannot remove
runtime approvals, raise retry budgets, or grant permission. Set
`MY_PI_FACTORY_PROJECT_POLICY=allow|trust|skip` for explicit headless
behavior.

## State, ownership, and recovery

Canonical workflow state is stored as size-limited, redacted mode-0600
JSON under `~/.pi/agent/factory` (override with `MY_PI_FACTORY_DIR`).
It records canonical workspace identity, route/contract versions,
nodes, attempts, owners, path claims, evidence, feedback, review
packets, version-bound explicit approvals, and correlation events.
Revision compare-and-swap plus exclusive claim locks prevent lost
concurrent updates; atomic writes make state resumable after process
loss. Schema v1 validates nested policy and state at runtime;
unsupported versions are rejected. No migration registry is claimed
until a second released schema exists. Completed nodes remain valid
unless an authoritative contract amendment invalidates downstream
work. Overlapping active claims are rejected. Stale heartbeats block
and escalate; they are evidence of missing ownership, not a claim that
Team Mode can supervise a peer.

Creation produces a real `pi-harness`; shell gates run through its
generated `validate.sh`, review packets run its `review.sh`, and
status/outcome paths are correlated. Tool-driven LSP/browser/database
gates consume evidence supplied by the operator or an SDK
`run_tool_gate` adapter. Failed gates become structured feedback and
are persisted before delivery to the owning Team Mode mailbox with
acknowledgement required (or the current session), within the node
retry budget. Delivery uses a packet-id outbox; failed delivery
remains inspectable and `factory action=flush-feedback` retries
without duplicating an already delivered packet.

Harness ids, Team Mode artifact/session ids, telemetry run ids, and
observability session ids are correlated in factory events. Aggregate
metrics are derived from canonical state plus those references:
first-pass success, validation/review retries, deterministic/reviewer
defects, escalation, interruption, substantial rework, lead time,
tokens, and cost. Existing manual harnesses and unclassified sessions
remain unchanged and distinguishable.

## Review and approval safety

Review packets contain the authoritative contract version, acceptance
criteria, changed files/diff hash, deterministic evidence,
constraints, and approval boundaries. Executor narrative remains
hidden until an initial verdict is recorded. Commit, push, deploy,
release, destructive, and configured public-contract actions require
explicit human decisions bound to the current contract and diff;
success, silence, mailbox delivery, or model output never counts as
approval. TUI tool approval requires a native confirmation dialog.
Headless/RPC tools cannot grant approval; an embedding application
must authenticate the human and call the programmatic API with
`authentication: 'embedding-application'`.

## Development

```bash
pnpm --filter @spences10/pi-factory run check:self
pnpm --filter @spences10/pi-factory run test:self
pnpm --filter @spences10/pi-factory run build
```
