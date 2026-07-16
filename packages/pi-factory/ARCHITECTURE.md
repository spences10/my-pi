# Factory v1 architecture boundary

## Product boundary

The target boundary for `@spences10/pi-factory` v1 is a thin
dispatcher and durable workflow ledger above Pi primitives. The core
must retain a reviewed task contract, explain a route, correlate one
harness and owner, record evidence, apply deterministic gates, prepare
independent review, stop for required human approval, and derive an
outcome.

This is a normative boundary. Authoritative contract and
complexity-aware routing are implemented: new state retains the task,
acceptance criteria, constraints, requested outcome, hash, and
version; all execution requests derive them from state. Child roles
run without the factory tool in the default RPC path and are guarded
read-only if custom launch arguments expose it. Turn settlement is not
success: only the controller can accept a contract-bound structured
result and transition a node. Durable ownership, acknowledged
transfer, harness adoption, canonical path scopes, truthful recovery,
and concise status are implemented. Outcome correlation remains #346.

The product must not become a general agent runtime. It cannot make an
independently opened Pi session observable or controllable, infer that
a mailbox recipient is active, treat process settlement as task
success, or grant commit, push, deploy, release, destructive, or
public-contract permission. Today an owned execution adapter can
supervise only the process it starts. Peer coordination is an explicit
operator handoff with evidence delivery, not process supervision or an
ownership guarantee.

## Primary journey

The target supported default path is:

1. A person or API supplies a task, acceptance criteria, constraints,
   requested outcome, paths, and requested side effects directly to
   `preview`; the preview includes the hashed authoritative contract.
2. The dispatcher returns the selected workflow, rationale, compute
   policy, gates, review mode, approvals, and path scope. The caller
   may review or strengthen the route before creation.
3. `create` stores the complete contract and route, creates one
   authoritative `pi-harness`, and records one mutating owner/path
   claim.
4. The owner either operates an execution adapter controlled by the
   factory or performs an acknowledged peer/operator handoff. The
   previous claim is released only when the recipient acknowledges.
   Peer turns make no process-liveness promise; unsupported owned
   recovery is immediately recorded as lost.
5. The harness runs deterministic validation. Failures become bounded,
   structured feedback to the owner; exhausted or unsafe correction
   escalates rather than redefining success.
6. An independent reviewer evaluates a packet bound to the contract,
   diff, changed files, constraints, and validation evidence.
7. Required side effects stop at a human approval node. Validation,
   review, silence, or delivery cannot imply approval.
8. The ledger records the terminal outcome and derives correlated
   metrics from authoritative state and referenced execution evidence.

This target journey needs no external-intake mapping,
repository-policy discovery, calibration dataset, recommendation,
canary, or adaptive policy. Those capabilities may strengthen or
automate inputs only when explicitly invoked.

## Responsibility map

| Capability                                        | Owns                                                                                                                          | Must not claim                                                                            |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Dispatcher and ledger                             | Direct intake, explained route, durable workflow state, node transitions, path claims, evidence correlation, terminal outcome | Execution success without contract-bound evidence; permission from policy or model output |
| Execution adapter                                 | Versioned execution intent and result for a factory-owned SDK/RPC process                                                     | Control of independently opened sessions; acceptance or lifecycle authority               |
| Peer coordination                                 | Addressed mailbox/artifact handoff, delivery and acknowledgement evidence                                                     | Peer liveness, process supervision, continued work, or exclusive ownership                |
| Harness                                           | One workflow-scoped contract, validation/review scripts, logs, and outcome paths                                              | A second source of workflow policy or multiple authoritative harnesses                    |
| Review                                            | Independent, diff-bound findings and verdict                                                                                  | Rewriting acceptance criteria, self-review, or human approval                             |
| Approval                                          | Authenticated human decisions bound to contract, diff, action, and scope                                                      | Approval inferred from success, silence, mailbox delivery, or model output                |
| Metrics                                           | Derivation from canonical state plus correlated execution/telemetry references                                                | Invented compute, cost, interruption, ownership, or success data                          |
| External intake (optional)                        | Provenance-preserving conversion of GitHub/incident events into reviewable intake                                             | A prerequisite for direct work; unauthenticated routing authority                         |
| Policy authoring (optional)                       | Discovering and activating reviewed repository strengthening rules                                                            | Permission grants or weakening runtime safety                                             |
| Calibration and learning (optional, experimental) | Offline evidence comparison and approved bounded recommendations                                                              | Changing the active route without complete correlated evidence and explicit authorization |

## Module and package decision

V1 remains one package with a stable core and explicit optional module
boundaries. Splitting packages now would add state-version and release
coordination before the core journey is proven, while providing no
safety benefit: the optional layers already require separate tool
actions or exported APIs and are not called by direct
`preview`/`create`/status operation.

The core consists of catalog/dispatch, engine/state, harness
integration, review/approval, and metrics derivation. Execution is an
adapter boundary selected explicitly by `operate`; peer mode records a
handoff. External intake, policy authoring, calibration, and
recommendations are optional modules. Advanced modules may add
provenance or strengthen policy, but may not remove core gates,
approvals, ownership records, or contract-bound evidence.

Compatibility consequences of this documentation/package decision:

- Existing root exports and factory tool actions remain available; no
  import path or action is removed or renamed.
- Existing schema-v1 stores remain in place. New optional claim
  enforcement, harness-adoption, and ownership-transfer fields are
  backfilled/read with safe defaults, so no schema-version migration
  is required.
- Existing schema-v1 workflows without contract fields load as
  `legacy-missing`. Their historical task is not recoverable, so the
  factory never invents one or substitutes a workflow description.
  They remain inspectable but execution is blocked until an explicit
  amendment supplies an authoritative contract.
- Optional-module records do not become core-path prerequisites.
- The architecture document ships with the package. This is a
  documentation/positioning change for the next normal package
  release, not a breaking release.

If a later package split is proposed, it must precede implementation
with an export/action compatibility map, ownership of every persisted
store, an atomic or backward-readable state migration, coordinated
package versions and release notes, install/upgrade tests, and updated
root/package documentation. Until those exist, the single package is
the supported layout.

## Decision validation

The decision was checked against the failed run and two successful
control-plane paths at the highest currently feasible exported API
boundary. These are not full TUI/harness end-to-end proofs:

| Workflow                                                                                                                                            | What is exercised                                                                                                                                                               | Result                                                                                                                                                                                                                                                                                                            |
| --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Failed explicit-any dogfood (`be4769dc-b917-4a82-858d-b489a7283b7f`)                                                                                | Task/route fidelity, harness/owner multiplicity, RPC settlement, acceptance evidence, and outcome correlation                                                                   | Post-hoc assessment is failure: canonical state marked execution succeeded and reached validation, then was cancelled after work completed outside the factory. The reproduced route rejects a low-capability chore; settled or reverted execution now remains non-success. #346 must repair outcome correlation. |
| Successful owned feature control-plane path (`src/execution.test.ts`, “progresses planner, executor, and validation nodes without manual relay”)    | Exported dispatcher/state/operator APIs, owned SDK adapter, actual shell gate processes, tool-gate adapter, and persisted progression                                           | Planner and executor results progress into successful deterministic validation without intake, discovered policy, calibration, or learning. It validates the module boundary through validation, not review/approval or extension UI.                                                                             |
| Successful direct chore control-plane path (`src/execution.test.ts`, “progresses a direct chore through owned execution and real validation gates”) | Exported dispatcher/state/operator APIs, one owner/path claim, owned execution, actual shell gate processes, tool-gate adapter, and terminal completion without review/approval | Reaches a terminal successful state without intake, policy discovery, calibration, recommendations, or learning.                                                                                                                                                                                                  |

The tests use deterministic SDK and tool adapters but execute real
shell gate processes through the public `WorkflowOperator` boundary.
They do not claim Team Mode supervision, extension UI coverage, a real
harness, or a live model run. Full owned/peer end-to-end evidence and
recovery remain later epic work; this architecture does not pre-claim
those outcomes.
