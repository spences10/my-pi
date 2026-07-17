# Pre-calibration dogfood baseline

Run with:

```bash
pnpm --filter @spences10/pi-factory run test:self -- src/dogfood.test.ts src/execution.test.ts src/factory.test.ts
```

The reproducible baseline covers:

| Workflow             | Baseline evidence                                                                       |
| -------------------- | --------------------------------------------------------------------------------------- |
| `chore`              | Direct owned execution and deterministic validation; route fixture in `dogfood.test.ts` |
| `feature`            | Owned planner/executor/validation/review path; route fixture in `dogfood.test.ts`       |
| `ambiguous-bug`      | Two verified read-only hypotheses before one mutating planner                           |
| `architecture`       | Non-mutating architecture route and required validation gates                           |
| `database-migration` | Approval-gated route with database validation and destructive/deploy approvals          |

`run_dogfood_baseline` returns deterministic route fingerprints,
effective parallelism, gates, and approval boundaries for these five
scenarios. The route-only rows are explicitly
`eligible_for_comparison: false`: they are synthetic control-plane
evidence, not measured outcome or compute data. Calibration remains
blocked until real executions add authoritative terminal outcomes plus
provider/model/reasoning, session, valid duration, telemetry or usage
bound to the current contract/node attempt, validation, review, and
approval correlation as applicable.
