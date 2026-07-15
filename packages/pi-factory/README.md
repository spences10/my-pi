# @spences10/pi-factory

Reusable software-factory control plane for Pi. Its target v1 core is
a thin dispatcher and durable workflow ledger above existing harness,
coordination, validation, review, approval, and telemetry primitives.
See the concise [v1 architecture boundary](./ARCHITECTURE.md) for the
target journey, current implementation gaps, responsibility map,
unsupported guarantees, and compatibility decision.

The factory supervises only a process started through an owned
execution adapter. It does not supervise independently opened sessions
or create another telemetry database.

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
The currently available direct path requires no external intake,
policy discovery, calibration, recommendation, canary, or
adaptive-evolution setup. Those features are optional modules that may
add provenance or strengthen policy, but cannot weaken or become
prerequisites for the core path. New workflows retain a hashed,
versioned authoritative task contract; legacy schema-v1 workflows are
loaded as `legacy-missing` and must be explicitly amended before
execution. Child settlement is recorded separately from controller-
validated completion; see the architecture document's gap list.

The catalog includes materially distinct `chore`, `feature`,
`ambiguous-bug`, `ui-copy`, `database-migration`, `incident`,
`architecture`, and `safe-release` workflows. Definitions select
capability/reasoning roles rather than requiring a provider. Routing
records work type separately from complexity. Affected surface,
numeric scale, semantic migration, and safety signals can strengthen
the effective workflow even when `chore` is requested; lowering
requests are ignored and explained. Roles without a resolved model are
reported as advisory. An explicitly configured model is enforced by
the owned RPC adapter together with its reasoning level. One mutating
owner is retained even where read-only hypotheses/research run in
parallel.

## Repository policy

A trusted project may provide `<CONFIG_DIR_NAME>/factory.json`
(normally `.pi/factory.json`):

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

### Discover and author repository policy

Use `factory action=policy-discover` to inspect repository files as
untrusted data and return a reviewable draft. Discovery reads package
scripts/workspaces, CI workflows, database and migration paths,
CODEOWNERS, release/deployment scripts, agent instructions, and
existing harness evidence; it never executes discovered commands. Each
inference includes source evidence and confidence, while conflicts and
schema gaps become focused review questions.

Edit the returned draft, then use `factory action=policy-validate`
with `policy_json` before `factory action=policy-activate`, or record
an explicit refusal with `factory action=policy-reject`. Activation
always requires a native human confirmation and atomically writes only
`<CONFIG_DIR_NAME>/factory.json`; headless callers must use the
exported `activate_policy_draft` API with a trusted repository root
and authenticated actor. Activation uses the draft's base-policy hash
to reject stale overwrites. Discovery never infers permission to
deploy or perform destructive work—those surfaces become approval
requirements. Only token-safe package commands and exact allowlisted
CI validations become executable gates; other shell content becomes a
review question. Discovery detects pnpm, npm, Yarn, and Bun commands
and reads safe single-line or multiline CI validations. Activation
rejects symlinked policy paths, uses exclusive unpredictable temporary
files, and rechecks the base hash immediately before rename.
Regeneration preserves reviewed rules, adds newly discovered
strengthening evidence, and reports drift. Programmatic consumers may
use `discover_repository_policy`, `discover_with_existing_policy`,
`validate_policy_draft`, `reject_policy_draft`, and
`activate_policy_draft`.

## External intake

The programmatic `github_intake_adapter` and `incident_intake_adapter`
convert external work into provenance-rich, untrusted canonical
intake. The factory tool exposes `intake-preview`, which returns both
the reviewed canonical intake and its explained route; existing task,
workflow, path, urgency, and side-effect parameters act as explicit
human overrides. `intake-reconcile` records intake without starting
work, while `intake-apply` creates, updates, pauses, cancels, or
resumes the one deterministically bound workflow. All three require a
trusted `known_projects_json` mapping. Facts, confidence-scored
derivations, human overrides, attachments, and lifecycle remain
separate. The mode-0600 `IntakeLedger` uses a canonical untampered
preview token, serializes writers, deduplicates delivery ids, rejects
stale updates, and retains pending lifecycle actions for retry after
transient callback failure. Project mappings cannot escape the
configured workspace; unauthenticated metadata remains review evidence
rather than routing authority.

## Execution adapters

`ExecutionController` persists an idempotent execution intent before
calling a versioned adapter and rejects stale contract/attempt
callbacks. Every SDK, RPC, recovery, and peer request embeds the exact
authoritative contract and effective role policy from state; caller
text and workflow descriptions cannot replace the task. SDK adapters
must confirm an enforced model/reasoning policy in their result; the
owned RPC adapter applies it as Pi CLI arguments. Unresolved policies
remain visibly advisory. `create_sdk_execution_adapter` and
`create_rpc_execution_adapter` represent owned execution surfaces. The
RPC adapter speaks Pi's strict JSONL prompt/event protocol.
`agent_settled` records only turn/process settlement. Completion
requires one protocol-v1 JSON result bound to the current contract,
with outcome, changed files, stable evidence ids, every authoritative
acceptance criterion and its evidence, failure classification, and any
review payload. Valid child evidence is canonicalised only after the
whole result passes validation; source ids are mapped to persisted
evidence ids and retained in contract-versioned acceptance
evaluations. Incomplete, refused, escalated, failed, malformed,
out-of-scope, evidence-free, weakened-criteria, and reverted/no-change
results become bounded feedback or escalation, never success. Execute
attempts carry a controller-captured Git workspace baseline;
completion compares the full tracked/untracked pre/post delta with
claimed files and applies exact glob scope semantics, so omitted or
disallowed changes fail closed. SDK adapters must return the same
protocol-v1 fields; legacy bare `lifecycle: "succeeded"` results now
fail closed as invalid structured results. `peer_execution_adapter` is
explicitly mailbox/operator-only and never claims process supervision.
`WorkflowOperator` is the only execution-node transition authority. It
progresses planner and executor work, runs factory-authoritative
validation, creates the independent review packet, and accepts only a
structured reviewer verdict bound to that packet and its exact diff.
Default RPC children exclude the `factory` tool; the runtime also
rejects recursive operate, self-completion, evidence injection, and
cross-workflow inspection when custom child arguments expose it.
Duplicate active owned attempts are rejected before another adapter is
started. It stops at human approval. The `operate` tool action uses an
owned RPC process by default (`execution_mode=peer` records an
operator handoff); command/argument overrides are available through
`MY_PI_FACTORY_RPC_COMMAND` and `MY_PI_FACTORY_RPC_ARGS`. One mutating
claim remains authoritative, while read-only research may run without
becoming a mutating owner.

## Calibration and controlled evolution

Versioned `CalibrationCase` and `ObservedOutcome` records pin
workflow, policy, route, compute, gates, project revision, and cohort
identity, including repository revision/shape, risk, parallelism,
retry, timeout, and optional evolution version.
`derive_calibration_report` labels only from explicit evidence and
blocks comparison when cohorts, metrics, incomplete runs, or sample
sizes are incompatible.

Recommendations consume a pinned calibration report through
`create_recommendation` and `simulate_recommendation`;
`recommend_calibration_change` derives a recommendation only when a
controlled cohort changes exactly one supported bounded field.
Material changes require an authenticated recorded decision before a
scoped canary, and the approved payload is hash-bound.
`PolicyEvolutionStore` requires new post-canary evidence pinned to the
exact evolution version before promotion. Rolling back an inactive
canary cannot replace the active version. Canonical workspace paths
define project canary scope, and every canary/promotion/rollback
appends a version instead of rewriting history. Active versions are
supplied to `dispatch_task`, which records their id and rationale in
resolved routes. Safety fields, approvals, validations, paths, risk,
and side-effect authority cannot be weakened; optional automatic
adjustment is limited to explicitly authorised low-risk fields.

## State, ownership, and recovery

Canonical workflow state is stored as size-limited, redacted mode-0600
JSON under Pi's `getAgentDir()/factory` (normally
`~/.pi/agent/factory`; override with `MY_PI_FACTORY_DIR`). It records
the canonical task, acceptance criteria, constraints, requested
outcome, contract hash/version, complexity evidence, workspace
identity, route versions, nodes, attempts, owners, path claims,
evidence, feedback, review packets, version-bound explicit approvals,
and correlation events. Revision compare-and-swap plus exclusive claim
locks prevent lost concurrent updates; atomic writes make state
resumable after process loss. Workflow UUID filenames are validated
and auxiliary JSON stores are excluded from workflow scans. Schema v1
validates nested policy and state at runtime; unsupported versions are
rejected. Older schema-v1 files without contract fields are backfilled
in memory as `legacy-missing` without inventing task text, remain
inspectable, and are blocked from execution until an explicit contract
amendment. No schema-version migration registry is claimed until a
second released schema exists. A contract amendment increments its
version and invalidates work derived from the previous contract.
Overlapping active claims are rejected. Stale heartbeats block and
escalate; they are evidence of missing ownership, not a claim that
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
