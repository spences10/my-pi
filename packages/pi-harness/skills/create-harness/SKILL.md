---
name: create-harness
# prettier-ignore
description: Use when assessing ambiguous or high-risk coding work before creating an approved task harness. Establishes evidence, existing primitives, rejected options, a smallest vertical slice, and an optional execution contract.
compatibility:
  Requires my-pi or Pi with the pi-harness extension tools enabled.
---

# Assess and Create Harness

A harness must be earned by an approved assessment. Do not turn
candidate capabilities directly into an execution contract.

## Use threshold

Start assessment when work may benefit from an enforceable execution
contract because it has material risk, unresolved scope, destructive
effects, or complex coordination. Good candidates include broad
uncertain refactors, migrations, deployments, risky releases, external
side effects, and explicit user requests.

Use direct work for bounded, low-risk tasks that standard validation
can verify. A simple ambiguity may need only a clarifying question.

## Workflow

1. Call `harness_assess` before repository mutation. Call it by
   itself.
2. Recover context with the remaining read-only tools.
3. Establish source of truth from concrete source, tests, docs,
   history, and observed behavior.
4. Find existing Pi, package, project, or platform primitives before
   proposing a new capability.
5. Challenge assumptions. Record rejected options and why the evidence
   rejects them.
6. Define the smallest useful vertical slice or falsifiable
   experiment.
7. Call `harness_assessment_submit` with one recommendation:
   - `direct` for bounded work;
   - `harness` when an execution contract adds value;
   - `reject` when the work has not earned adoption.
8. For a harness recommendation, include explicit allowed paths and
   validation commands in the proposed contract.
9. Wait for direct user approval. Do not infer approval from agent
   text or continue implementation while approval is pending.
10. The extension creates and activates an approved harness
    atomically. Run it with the `execute-harness` skill. Harness
    approval does not authorize Factory; use Factory only after a
    direct user request to evaluate it. Do not call `harness_create`
    to bypass assessment.

## Scope changes

Use `harness_amend` for bounded changes inside an approved capability.
A new capability, architecture decision, or outer-policy expansion
requires another assessment.

## Rules

- Assessment state is session control state, not project source.
- Read-only mode forbids project edits, writes, commits, package
  installation, delegation, and other mutating tools.
- A rejected capability is a valid outcome.
- Do not create a planner, task graph, or backlog from rejected
  candidates.
- Do not implement during assessment.

## Output

Submit only the structured assessment record. The extension presents
it for user approval and handles the chosen exit.
