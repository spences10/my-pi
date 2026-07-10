# Persistent-runtime release and dogfood checklist

This checklist is the release contract for the experimental persistent
Team Mode runtime. Keep evidence bundles out of git; publish redacted,
bounded bundles as CI or release artifacts. A mailbox row or session
file proves storage only, not model execution.

## Evidence header

Record once for every run:

- [ ] git SHA and clean/dirty state
- [ ] package version, tarball SHA-256, and install source
- [ ] Node, Pi, model, and provider versions
- [ ] UTC start/end time and exact commands
- [ ] coordination DB location (path redacted where necessary)
- [ ] session ids, parent graph, runtime PID, and process-start
      identity
- [ ] lifecycle/receipt transitions and JSONL parse/duplicate verdicts
- [ ] bounded, redacted stderr; TUI screenshot/cast only where visual
      attachment behavior matters

## Automated gates

Run in order and retain command output:

- [ ] `pnpm --filter @spences10/pi-team-mode run check:self`
- [ ] `pnpm --filter @spences10/pi-team-mode run test:self`
- [ ] `pnpm --filter @spences10/pi-team-mode run coverage:self`
- [ ] `pnpm --filter @spences10/pi-team-mode run test:pack`
- [ ] `pnpm run check`
- [ ] real-runtime integration suites: readiness/native turns,
      ownership/resume, recursion/limits, delivery/recovery,
      safety/isolation
- [ ] adversarial fault injection at `created`, `starting`, `ready`,
      `accepted`, `read`, and `acknowledged`
- [ ] install the produced tarball into a clean vanilla Pi project and
      run an A-lite native turn from the installed artifact
- [ ] install the published npm version in a clean sandbox, alone and
      with the supported installable package set; record local/npm
      drift

`test:pack` builds clean, packs, seeds a forbidden stale `dist` file,
rebuilds, packs again, compares normalized tar lists, and rejects
known removed runtime paths. It does not depend on the unfinished
runtime.

## Dogfood A–E

### A — persistent happy path

- [ ] Spawn three teammates and wait for protocol readiness; do not
      ping or resume them to manufacture readiness.
- [ ] Verify stable session ids and exactly one owner per teammate.
- [ ] Deliver native Pi turns and collect three structured outcomes in
      the lead.
- [ ] Verify explicit shutdown and completion/failure events.

### B — ownership and resume/attach

- [ ] Record session id, owner PID, and process-start identity.
- [ ] Verify native task, tool, and Team Mode turns in parseable
      history.
- [ ] Steer/follow up on the same owning runtime, then detach without
      stopping its work.
- [ ] Verify owner identity and work survive and exactly one process
      writes the JSONL.
- [ ] Do not mark live `/resume` attach passed until upstream Pi can
      attach a TUI to the running owner; opening a second writer is a
      fail.

### C — recursive lifecycle and limits

- [ ] Build lead → lead → two workers.
- [ ] Verify direct reports reach configured recipients after the top
      TUI closes.
- [ ] Verify graph/status and native session history at every level.
- [ ] Verify parent closure behavior plus depth and concurrency
      limits.

### D — delivery and recovery

- [ ] Send numbered concurrent and duplicate messages; verify order
      and idempotency.
- [ ] Kill a runtime mid-turn; verify explicit failure and durable
      pending receipt.
- [ ] Restart the same session and process pending work exactly once.
- [ ] Verify monotonic receipt transitions, stale lease/PID handling,
      parseable JSONL, and zero duplicate turns.
- [ ] Exercise malformed protocol, startup/provider failure,
      timeout/cancel, and bounded/redacted diagnostics.

### E — safety and isolation

- [ ] Set a non-secret environment sentinel; prove it is absent from
      the child while explicitly allowlisted variables pass.
- [ ] Prove workspace collision rejection or explicit isolation.
- [ ] Prove spoofed sender identities and unknown fields are rejected.
- [ ] Verify recursive depth/concurrency boundaries cannot be
      bypassed.

## Release decision

- [ ] A–E each have an automated verdict and a reviewed dogfood
      bundle.
- [ ] Clean tarball, user install, and published sandbox gates pass.
- [ ] `/resume` is described as non-attaching until upstream support
      lands; no release note claims otherwise.
- [ ] All failures are classified as introduced, pre-existing, or
      environment-only, with owner and follow-up.
- [ ] Only after every gate passes may the persistent path become the
      default.
