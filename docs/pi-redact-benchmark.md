---
title: Redaction benchmarks
tags: [benchmarks, pi-redact, security]
aliases: [pi-redact benchmark, Redaction performance]
---

# Redaction benchmarks

Compare the actual published
[`@spences10/pi-redact`](https://www.npmjs.com/package/@spences10/pi-redact)
package with a local build using the same synthetic inputs, Node
runtime, machine and sampling. This measures `redact_text`, not Pi
session latency or the security of a complete tool workflow.

See the [package README](../packages/pi-redact/README.md) for
supported behavior and limitations, the
[implementation](../packages/pi-redact/src/index.ts), and
[regression tests](../packages/pi-redact/src/index.test.ts).

## Recorded results

Recorded on 2026-11-14 at 17:32 UTC using Node **24.15.0**, Linux x64
and an AMD Ryzen AI 9 HX 370 (24 logical CPUs). The
[JSON report](./data/pi-redact-benchmark.json) contains all 71 timing
rows, individual samples, corpus outcomes and provenance. It records
`completed: true` and verifies that the compiled local files stayed
unchanged during the run. Both manifests say `0.0.16`; **local** means
the unreleased build identified by the report's JavaScript hashes, not
a second copy of the published package.

Median milliseconds per call, without registered values:

| Input                  | Published 8 KiB | Local 8 KiB | Published 50 KiB | Local 50 KiB | Published 200 KiB | Local 200 KiB |
| ---------------------- | --------------: | ----------: | ---------------: | -----------: | ----------------: | ------------: |
| Long hex               |          73.739 |       0.069 |          timeout |        0.350 |           timeout |         2.634 |
| Repeated `eyJ`         |         134.082 |       0.169 |          timeout |        2.139 |           timeout |         8.035 |
| Newlines               |          62.198 |       2.934 |          timeout |       19.164 |           timeout |        72.374 |
| Repeated `a.`          |          20.239 |       0.098 |          655.346 |        0.483 |           timeout |         3.833 |
| Incomplete PEM headers |           6.306 |       0.149 |          125.684 |        0.640 |           timeout |         1.221 |
| Ordinary source        |           0.181 |       0.156 |            2.320 |        0.793 |             9.185 |         3.200 |

The published artifact hit the five-second **process** deadline in
nine cells: `eyJ` at 32 KiB, hex/`eyJ`/newlines at 50/200 KiB, plus
dotted text and PEM headers at 200 KiB. Local runs had no timeouts.
The JSON also contains the 16/32 KiB measurements. A timeout does not
supply a numeric per-call latency or speedup ratio.

Normal-output fixture, also without registered values:

| Size    | Published ms | Local ms |
| ------- | -----------: | -------: |
| 4 KiB   |        0.231 |    0.108 |
| 50 KiB  |        1.556 |    1.077 |
| 200 KiB |        9.464 |    4.681 |

These results show substantially lower latency on the constructed
failure cases, not a universal speedup across arbitrary workloads.
Normal-output timings apply only to the fixed log block described
below.

## Reproduce

From an installed checkout on Node 24.15.0 or newer:

```bash
pnpm --filter @spences10/pi-redact run build
node scripts/benchmark-pi-redact.ts \
  --published 0.0.16 \
  --local packages/pi-redact/dist/index.js \
  --out /tmp/pi-redact-results.json
```

Omit `--published` to resolve npm's current `latest` tag. The recorded
baseline is **0.0.16**, the latest release when queried for this
comparison. A later run against `latest` may compare different code;
pin the version to reproduce this baseline.

The [driver](../scripts/benchmark-pi-redact.ts):

1. Queries public npm metadata, checks the workspace
   `minimumReleaseAge` policy, and downloads an exact published
   version into a new temporary sandbox. It does not modify repository
   manifests or the lockfile, install dependencies, or execute package
   lifecycle scripts. A release that is too new fails rather than
   bypassing policy.
2. Runs `npm pack @spences10/pi-redact@0.0.16 --ignore-scripts --json`
   and `tar -xzf spences10-pi-redact-0.0.16.tgz` for this baseline. It
   verifies the tarball against npm's SHA-512 integrity and verifies
   the extracted package identity. Published code always comes from
   this tarball, never from a source checkout.
3. Links the extracted package's `node_modules` to the checkout's
   installed dependencies. This isolates package code, **not
   dependency versions**. It is not a clean-install compatibility
   test. The JSON records dependency information, runtime/CPU, tarball
   integrity, compiled JavaScript hashes, and script/corpus hashes.
4. Runs each artifact/fixture in a fresh child process, sequentially,
   alternating published/local order. Each child imports its artifact,
   constructs the input, makes one untimed warmup call, then records
   three samples. Normal-output samples average 20 calls each; adverse
   samples contain one call. The table uses median milliseconds per
   call.
5. Saves JSON incrementally; `completed: true` means the entire run
   finished and the local compiled artifact did not change during it.
   Sandboxes and the report remain on disk for inspection.

Defaults are `--samples 3 --timeout-ms 5000`. The sample count must be
a positive integer. The timeout covers the **entire child process**,
including startup, imports, warmup and samples. A timeout is not a
measured five-second call, nor a numeric speedup bound. Failed
children abort the run; expected timeouts are recorded and the other
cases continue. Do not benchmark while rebuilding the local artifact
or running other CPU-heavy checks.

## Workloads

All values are fixed synthetic fixtures. No real credentials,
environment secrets, live provider requests or random corpora are
used. Every input is ASCII, so the requested byte size is exact.

| Class                  | Repeated input                                                                        | Sizes                  |
| ---------------------- | ------------------------------------------------------------------------------------- | ---------------------- |
| Long hex               | `16f3a8b92c4d570e`                                                                    | 8, 16, 32, 50, 200 KiB |
| JWT-like prefix        | `eyJ`                                                                                 | 8, 16, 32, 50, 200 KiB |
| Whitespace             | newline                                                                               | 8, 16, 32, 50, 200 KiB |
| Dotted text            | `a.`                                                                                  | 8, 16, 32, 50, 200 KiB |
| Incomplete PEM headers | `-----BEGIN `                                                                         | 8, 16, 32, 50, 200 KiB |
| Ordinary source        | `export const item = queue.shift();` plus newline                                     | 8, 16, 32, 50, 200 KiB |
| Normal output          | repeated build-log block with a synthetic GitHub token and an unlabelled opaque value | 4, 50, 200 KiB         |

The first five classes target costly failure paths. Ordinary source is
a benign control. The normal-output fixture exercises successful
redaction and string replacement, but its repeated log block is not a
production traffic distribution. The newline workload exceeds the
built-in tools' line cap; it remains relevant to uncapped extension
output. KiB means 1,024 bytes.

### Exact-value overhead

The published baseline has no registered-value option. Its
measurements never pass one. A separate local-only variant uses
`redact_text(text, { known_values })` with 32 fixed synthetic values:
ordinary source at 50/200 KiB contains no registered values; normal
output at 4/50/200 KiB contains repeated matches for one registered
value. Compare these rows with **local default**, not published code.
Registry matching and any supported variant preparation inside
`redact_text` are included. These workloads do not establish behavior
for large registries or all encodings.

| Local workload                   | Default ms | With 32 registered values, ms |
| -------------------------------- | ---------: | ----------------------------: |
| Source, 50 KiB (no matches)      |      0.793 |                         1.311 |
| Source, 200 KiB (no matches)     |      3.200 |                         3.345 |
| Normal output, 4 KiB (matches)   |      0.108 |                         0.252 |
| Normal output, 50 KiB (matches)  |      1.077 |                         1.625 |
| Normal output, 200 KiB (matches) |      4.681 |                         6.082 |

Registered-value matching added time in these samples, with the
difference varying by fixture. Three samples do not establish a stable
marginal overhead for other inputs or registry sizes. Treat these as
observed timings, not guaranteed penalties.

### Detection and preservation corpus

A separate untimed corpus contains 12 synthetic secret appearances and
12 benign source/config/documentation examples. Masking passes when
both the full synthetic value and its last six characters disappear.
This checks substantial remnants, not every leaked bit or intentional
prefix retention. Benign changes and repeat-redaction instability are
reported per case. Example passwords and masked placeholders involve
policy choices; altered executable expressions establish a clearer
false positive.

These hand-picked cases are diagnostic examples, **not general
detection or false-positive rates**. They deliberately include
unlabelled and encoded values that pattern matching cannot reliably
identify.

| Artifact         | Secret appearances masked | Benign examples changed | Unstable repeat outputs |
| ---------------- | ------------------------: | ----------------------: | ----------------------: |
| Published 0.0.16 |                      8/12 |                    9/12 |                    0/24 |
| Local default    |                      8/12 |                    2/12 |                    0/24 |

Both missed the six-character password fixture and the unlabelled,
base64 and URL-encoded fixtures. Local still changed a masked password
placeholder and a documentation path containing a provider-shaped
substring. The reduced benign-change count does not imply complete
source preservation or improved recall on this small corpus.

## Acceptance tests are separate

Benchmark numbers and corpus counts do not gate security acceptance.
Guardrail and regression assertions live in the package tests:

```bash
pnpm --filter @spences10/pi-redact run check
pnpm --filter @spences10/pi-redact run test
```

A fast detector may still miss a secret or alter useful source code.
Passing tests establishes only their stated invariants; neither the
tests nor this benchmark prove all output routes are safe. Streaming,
structured tool data, persistence, direct shell output and auxiliary
model requests require their own runtime coverage. Timing excludes
extension hooks and live streaming, process startup, disk/tool I/O,
provider requests, memory usage and end-to-end agent latency.

Elapsed times vary with CPU load, JIT behavior, garbage collection and
runtime version. A single machine with three samples supports scoped
comparisons of these fixtures, not broad best-case speed claims.
