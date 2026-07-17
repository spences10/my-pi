# Factory calibration baseline status

## Status: blocked

No real-world baseline is claimed by this repository revision. The
repository contains no authorised live-provider executions spanning
all workflows and no representative external-project terminal evidence
with complete current-attempt correlation. Route-only dogfood remains
synthetic and excluded.

## Reproducible suite and report paths

- Suite definition/store/import API: `src/calibration-suite.ts`
- Suite validation and blocked/valid report tests:
  `src/calibration-suite.test.ts`
- Synthetic route matrix: `src/dogfood.ts`
- Dogfood status: `DOGFOOD_BASELINE.md`

Run:

```bash
pnpm --filter @spences10/pi-factory run test:self -- src/calibration-suite.test.ts src/calibration.test.ts
```

A real baseline becomes valid only after `CalibrationSuiteStore`
imports the configured minimum sample for every workflow from
authoritative correlated outcomes. Each outcome must carry
`factory-state` or authenticated-import provenance (never `synthetic`)
and preserve suite/case/report version, project and policy revision,
workflow/route/compute/gate pins, explicit evidence-derived label,
provider/model/reasoning, session, valid duration, measured usage or
telemetry, every current-contract attempt, and terminal
validation/review/ approval evidence. Sparse, synthetic, incomplete,
contradictory, stale, or incompatible rows remain queryable but block
baseline promotion and recommendations.
