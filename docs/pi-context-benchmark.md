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
