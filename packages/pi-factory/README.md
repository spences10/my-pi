# @spences10/pi-factory

Experimental reviewed execution for one local Pi child. Factory is
disabled by default in `my-pi` and must be explicitly enabled for
evaluation.

## Scope

The entire normal path is one operation:

```text
pi-harness contract → one owned local executor → contract validation → independent diff-bound reviewer → structured report
```

Create a harness first, then call `factory_start` with its directory.
The harness is authoritative for the task, workspace, runtime path,
command and test policy, role models, dirty baseline, and validation
commands. The report distinguishes validated completion, failure,
refusal, and interruption and records lifecycle, changed files,
validation evidence, review, and model/provider identity.

`factory_start` uses normal object-schema tool calling because its
optional timeout is not portable across providers' strict-schema
rules.

## Non-goals

There is no classifier, workflow graph, path ledger, peer transfer,
SSH/remote mode, external intake, policy authoring, recommendations,
learning, calibration, or adaptive routing. Use direct Pi for ordinary
work, `pi-harness` for bounded contracts, and Team Mode for peer
coordination. Issues #358-#360 remain the source of truth for future
first-party child-agent lifecycle primitives; this package does not
duplicate them.

## Evaluation boundary

The replacement is unsupported until the ten-task benchmark in
`BENCHMARK.md` passes. Restoring default loading requires separate
evidence and review. If the benchmark fails, deprecate and archive
this package rather than expanding its scope.

## Development

```bash
pnpm --filter @spences10/pi-factory run check
pnpm --filter @spences10/pi-factory run test
pnpm --filter @spences10/pi-factory run build
```
