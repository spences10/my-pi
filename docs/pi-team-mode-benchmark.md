---
title: Team Mode delivery benchmarks
tags: [benchmarks, pi-team-mode, coordination, context]
aliases: [Team delivery benchmark, Team Mode benchmarks]
---

# Team Mode delivery benchmarks

Measured delivery behavior for
[pi-team-mode](../packages/pi-team-mode/README.md).

Run on Node 26 against temporary SQLite databases, with no network or
paid model calls:

```bash
pnpm --filter @spences10/pi-team-mode run build:self
pnpm --filter @spences10/pi-team-mode run benchmark:self
# Optional comparison against a previously captured JSON result:
node packages/pi-team-mode/scripts/benchmark.ts --assert \
  --baseline /tmp/team-delivery-baseline.json --out /tmp/team-delivery-current.json
```

The [script](../packages/pi-team-mode/scripts/benchmark.ts) is
TypeScript executed directly by Node. It asserts delivery invariants
and reports UTF-8 content bytes, stored messages, represented message
ids, wake-ups, continuation batches, and informational elapsed times.
Byte counts describe messages entering context once, not total
provider input tokens across repeated requests. Timings are not a
stable latency benchmark. The baseline was captured before
implementation.

## Measured stages

| Scenario                                                           | Baseline | Receipts + retry keys |  Final |
| ------------------------------------------------------------------ | -------: | --------------------: | -----: |
| 100 sends with one retry key: stored messages                      |      100 |                     1 |      1 |
| Same retry scenario: injected bytes                                |   21,115 |                 1,018 |    422 |
| Inbox retrieval followed by automatic polling: repeated deliveries |        1 |                     0 |      0 |
| 100 keyed status updates: wake-ups                                 |      100 |                   100 |      0 |
| Same status scenario: injected bytes                               |  101,290 |               101,290 |    495 |
| 100 distinct actions: total injected bytes                         |   43,935 |                43,935 | 34,898 |
| Same action backlog: largest batch in bytes                        |   43,935 |                43,935 |  2,772 |

Final changes reduce retry-scenario bytes by **98.0%**,
status-scenario bytes by **99.5%**, and actionable-backlog bytes by
**20.6%**. No distinct actions are deduplicated or discarded. The 100
status records remain in SQLite; one latest preview represents them
all.

A separate completed-context projection scenario reduces 100
acknowledged custom messages from **79,790 bytes to 607 bytes
(99.2%)**, measured against the same final-format transcript without
the projection. This comparison is not a historical baseline
measurement. The durable records remain unchanged.

## Wake-ups versus continuations

A wake-up starts processing while idle. A continuation is another
model request within an already-running activity. The bounded
100-action backlog uses **one wake-up and twelve continuation
batches** instead of putting the entire backlog into one request. This
intentionally trades additional provider requests for a hard
per-delivery context budget; it does not claim lower total token usage
or end-to-end latency.

The benchmark simulates settlement boundaries and persistence
confirmations.
[Upstream delivery tests](../packages/pi-team-mode/src/upstream-delivery.test.ts)
additionally exercise the real installed Pi SDK with upstream's faux
provider. It checks that an action arriving during a run persists
through `agent_before_settle`, is confirmed from reconstructed
context, and produces one continuation. Status arriving during a run
waits for the next explicitly started run. Other regression tests
cover UTF-8 limits, all-action delivery, sender/key isolation, enqueue
failure, confirmation retries, crash reconciliation, abort handling,
authority provenance, and non-mutating context summaries.
