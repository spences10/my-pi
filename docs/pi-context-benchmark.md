# pi-context benchmark notes

Benchmarked on 2026-06-19 while evaluating lower-context retrieval
changes for `@spences10/pi-context`.

## Scenario

Prompted `my-pi` to use `mcp-omnisearch` to extract the SvelteKit
remote functions documentation page with Tavily advanced extraction
and answer from the result:

```text
https://svelte.dev/docs/kit/remote-functions
provider: tavily
extract_depth: advanced
include_raw_contents: true
large_result_mode: inline
```

Compared published `pnpx my-pi@latest` against local
`node ./dist/index.js` with the same prompt, isolated session
directories, telemetry DBs, and context DBs.

## Results

| Metric                      | Published | Local capped changes | Reduction |
| --------------------------- | --------: | -------------------: | --------: |
| Tool calls                  |        49 |                   27 |       45% |
| Context tool chars returned |   438,655 |              181,417 |       59% |
| Total tool chars returned   |   488,258 |              196,530 |       60% |
| Input tokens                |   163,626 |              116,844 |       29% |
| Cache-read tokens           | 2,943,488 |              884,224 |       70% |
| Total tokens                | 3,113,785 |            1,004,674 |       68% |
| Cost                        |     $2.49 |                $1.13 |       54% |

## Notes

The local run used snippet-first `context_search` plus
`context_export` once. The published run repeatedly pulled full search
chunks into chat. An initial local pass before capping neighbor ranges
reduced total tokens 64% and cost 52%, but still requested broad
`context_get` ranges (`after:9` and `after:13`). The capped run limits
neighboring chunk ranges to 3 each side and strengthens receipt/tool
guidance to prefer `context_export` for broad JSON/log/script
processing.

## Additional sample checks

These extra runs are useful validation data, but the headline README
claim should stay scoped to the search-heavy MCP extraction benchmark
above. Some tasks are already cheap with the published flow or do not
route through the sidecar heavily, so the new flow is not universally
lower-token in every prompt.

| Scenario                                  |                      Published |                   Current flow | Result                                                             |
| ----------------------------------------- | -----------------------------: | -----------------------------: | ------------------------------------------------------------------ |
| SvelteKit remote-functions MCP extraction | 3,113,785 total tokens / $2.49 | 1,004,674 total tokens / $1.13 | 68% fewer total tokens, 54% lower cost                             |
| SvelteKit load docs MCP extraction        |   124,576 total tokens / $0.45 |   339,400 total tokens / $0.46 | 30% fewer input tokens, but more turns/cache reads                 |
| Synthetic 2,500-line JSONL stdout         |    72,353 total tokens / $0.19 |   122,456 total tokens / $0.44 | 94% fewer context-tool chars, but export/script overhead dominated |
| Large source read of `src/index.ts`       |   106,788 total tokens / $0.21 |   134,696 total tokens / $0.24 | Direct read-heavy workflow; sidecar tools were not used            |

Takeaway: the strongest win is for large MCP/search workflows where
the published tool repeatedly returns full chunks. Snippet-first
search and file export reduce returned context substantially there.
Deterministic one-shot tasks can still be cheaper if the model answers
from a single small search result, so benchmark claims should identify
the workflow.

## Native codemode benchmark

This is a separate deterministic benchmark, not an update to the
historical API-token/cost figures above. It compares the sidecar at
Git revision `e97db4c`, the codemode-first changes, and native Pi with
no sidecar, all using **Pi 1.4.0 / Node.js v24.15.0**.

### Method

The runner uses native codemode workers and real nested tool dispatch
through the Pi SDK. A scripted assistant fixture issues the calls;
there are **no LLM requests, credentials, external MCP servers, or
network calls**. Final results pass through the sidecar's real
`tool_result` handlers. Each case has an isolated session, database,
settings, and temporary directory. Capture thresholds are fixed at 24
KiB / 300 lines, with retention and size cleanup disabled.

Five cases run three times for each variant (45 checks total):

- Bash: generate 400 metric rows and return their count/sum.
- Read: read the same 400 rows from a file and return their count/sum.
- MCP-shaped fixture: return 1,000 metric rows with a native-style
  structured result and return their count/sum. This exercises the
  structured result contract, not transport or server latency.
- Final overflow: deliberately print 800 diagnostic lines and verify
  that a marker remains retrievable. This exceeds the line threshold
  (not the byte threshold). Sidecar variants verify it with search;
  native-only can read the marker directly from the inline output.
- Small output: return a tiny summary as a control.

When the baseline replaces an intermediate result with a receipt, that
receipt reaches the model-facing boundary and the scripted workflow
makes one recovery call to retrieve and summarize the source. The new
and native-only variants summarize the original result in the first
script. No full intermediate result is printed during recovery. The
final-overflow case deliberately returns all text so the fallback can
be measured separately from successful filtering.

### Results

UTF-8 **model-facing output bytes**, including codemode wrappers,
receipts, and recovery summaries; values were identical across all
three repeats:

| Workload       |  Baseline | Codemode-first | Native-only |
| -------------- | --------: | -------------: | ----------: |
| Bash filtering |     1,390 |             73 |          73 |
| Read filtering |     1,390 |             73 |          73 |
| MCP filtering  |     1,413 |             75 |          75 |
| Final overflow |     1,612 |            543 |      14,464 |
| Small output   |        67 |             67 |          67 |
| **Total**      | **5,872** |        **831** |  **14,752** |

Per five-workload suite:

| Metric                             | Baseline | Codemode-first | Native-only |
| ---------------------------------- | -------: | -------------: | ----------: |
| Correct results                    |      5/5 |            5/5 |         5/5 |
| Top-level calls                    |        9 |              6 |           5 |
| Context retrieval calls            |        4 |              1 |           0 |
| SQLite sources captured            |        4 |              1 |           0 |
| SQLite source text bytes           |   33,941 |         14,464 |           0 |
| Active tool declaration JSON bytes |    8,619 |          7,542 |       3,306 |

The codemode-first suite returns **86% fewer output bytes** than the
baseline. The three filtering cases return **95% fewer bytes**, create
no SQLite sources, need no retrieval, and match native-only output
size. Compact receipts reduce the final-overflow case by **66%**
versus the baseline while keeping it searchable. Deferring maintenance
tools reduces the active tool declaration representation by **12%**;
this remains larger than native-only because retrieval tools are still
available.

Raw measurements, including per-case wall times:
[`codemode-benchmark-results.json`](../packages/pi-context/test/codemode-benchmark-results.json).
The executable runner lives in
[`codemode-benchmark.ts`](../packages/pi-context/src/eval/codemode-benchmark.ts).

### Limits

- These are **bytes, not measured provider tokens or billed cost**.
  Tool declaration size is reported separately, not added to output
  bytes or treated as an actual provider request. Script input,
  reasoning, prompt caching, and autonomous tool selection are not
  measured.
- Wall times include worker startup and are not a latency claim.
- Native-only is sufficient when scripts reduce their output. The
  sidecar adds value when large output intentionally reaches the model
  and later needs search; that costs a retrieval call versus keeping
  everything inline.
- Fixtures cover the nested-call contract and searchable fallback, not
  every real-world research workflow or native truncation limit.
  Separate regression tests cover native structured-output selection,
  partial-output labeling, image preservation, redaction before
  persistence, and output-schema validity.

### Reproduce

From the repository root, with dependencies installed:

```bash
pnpm --filter @spences10/pi-context run build

# Compile the old package without changing the working tree or Git index.
BASELINE=$(mktemp -d /tmp/pi-context-baseline-XXXXXX)
git archive e97db4c packages/pi-context | tar -x -C "$BASELINE"
ln -s "$PWD/node_modules" "$BASELINE/node_modules"
ln -s "$PWD/packages/pi-context/node_modules" "$BASELINE/packages/pi-context/node_modules"
pnpm exec tsc -p "$BASELINE/packages/pi-context/tsconfig.build.json"
cp "$BASELINE/packages/pi-context/src/schema.sql" "$BASELINE/packages/pi-context/dist/schema.sql"

node packages/pi-context/dist/eval/codemode-benchmark.js \
  --baseline "$BASELINE/packages/pi-context/dist" \
  --runs 3 --output /tmp/pi-context-codemode-results.json
```

Omit `--baseline` to compare only the current implementation with
native-only. No API credentials are required. Each case removes its
own temporary session/database/files; the explicitly created baseline
directory and requested report are retained for inspection.
