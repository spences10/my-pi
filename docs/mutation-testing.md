---
title: Mutation testing and test intent
tags: [development, testing, mutation]
aliases: [Stryker, Test audit]
---

# Mutation testing and test intent

Mutation testing checks whether tests detect changes to
implementation. It does not establish whether the behaviour those
tests preserve is wanted. Review expectations against actual callers
and intended behaviour before recommending tests to keep, rewrite, or
remove.

## Run Stryker

Stryker and its Vitest runner are root dev dependencies. After
`pnpm install`, run from the repository root:

```bash
pnpm run test:mutation
```

The [default configuration](../stryker.config.json) mutates
`packages/pi-coding-preferences/src/index.ts`. The
[mutation test configuration](../vite-mutation.config.ts) selects that
package's tests. This is a focused starting point, not a whole-repo
mutation score.

Select another package's tests and the production source to mutate:

```bash
MUTATION_TEST_DIR=packages/pi-context pnpm run test:mutation \
  --mutate packages/pi-context/src/policy.ts
```

`MUTATION_TEST_DIR` selects tests; `--mutate` selects implementation.
Set both when changing packages. Pass a comma-separated source list
for multiple files. Do not include test files in the mutation list.

The script builds workspace packages first. When those build inputs
are unchanged, reuse them with `pnpm exec stryker run` and the same
environment/flags. Add `--dryRunOnly` to check runner compatibility
without executing mutations.

Reports are written to `reports/mutation/mutation.html` and
`reports/mutation/mutation.json`. Each run replaces those reports;
copy them into named subdirectories there when comparing runs. Reports
and `.stryker-tmp/` sandboxes are gitignored. This guide keeps the
review decisions in version control, rather than committing
machine-specific reports containing complete source and test data.

The runner uses Node tests and aliases `vite-plus/test` to one Vitest
instance. This avoids mixing package-local Vitest installations in a
root-level run. Browser tests or package-specific Vite plugins need
their own configuration. Cross-package imports may resolve built
`dist` files: source mutations do not automatically instrument those
copies. Check the report's tested files before claiming integration
coverage.

Static mutants remain enabled. Test selection is in the Vitest
configuration rather than Stryker's `testFiles` option. Local
exploratory runs have no score gate.

## CI score gates

The [CI workflow](../.github/workflows/ci.yml) runs three mutation
jobs on root pull-request and main-branch changes, using the same
change filter as the ordinary CI job. Each target must meet its own
floor:

| Target                              | Measured baseline | Minimum score |
| ----------------------------------- | ----------------: | ------------: |
| Coding preferences `src/index.ts`   |            75.63% |           75% |
| Harness `src/enforcement/policy.ts` |            78.82% |           78% |
| Tool guidance `src/index.ts`        |            79.78% |           79% |

These are the measured post-audit scores rounded down to whole
percentages, not an arbitrary target of 100%. Stryker's full mutation
score includes uncovered mutants in the denominator; killed and
timed-out mutants count as detected. A stronger target cannot mask a
weaker one because jobs are gated separately. These three targets do
not represent whole-repository coverage.

The [CI configuration](../stryker.ci.config.ts) reuses the local
configuration and sets Stryker's native `thresholds.break` from
`MUTATION_MIN_SCORE` (75 by default). A score below the floor exits
nonzero and fails the job. Scores and mutant details appear in the job
logs. Reproduce a job locally with:

```bash
MUTATION_TEST_DIR=packages/pi-harness MUTATION_MIN_SCORE=78 \
  pnpm run test:mutation stryker.ci.config.ts \
  --mutate packages/pi-harness/src/enforcement/policy.ts
```

The floors live in the workflow matrix. Review score changes against
wanted behaviour rather than adding implementation-specific assertions
solely to satisfy the gate.

## Audit scope

The initial inventory contained 183 tracked test files, including 32
assertions named `loads without side effects`. No unconditional
skip/todo declarations were found in the literal scan; nine `skipIf`
declarations were platform-dependent.

The first Stryker 10.1.1 / Vitest 5.1.0 pass mutated four source
files:

| Source                              | Killed | Timeout | Survived | No coverage |
| ----------------------------------- | -----: | ------: | -------: | ----------: |
| Coding preferences `src/index.ts`   |    161 |       1 |       38 |          38 |
| Harness `src/enforcement/policy.ts` |     53 |       0 |       28 |           4 |
| Tool guidance `src/index.ts`        |     70 |       0 |       14 |           5 |
| TUI modal `src/modal/progress.ts`   |      0 |       0 |      118 |           0 |

These 530 mutants are a targeted baseline, not a review of every test
or a product-wide score. The progress-modal run executed all 19
package tests against every mutant with related-test selection
disabled. Its survivors covered no implementation statements; do not
compare its status labels mechanically with the other runs.

## Applied decisions

- **Allow compatible footer exports.** The
  [library API](../packages/pi-footer/README.md#library-api) permits
  additive exports. Its
  [test](../packages/pi-footer/src/index.test.ts) now requires
  supported exports without insisting they are the only exports. A
  temporary-copy experiment established that adding an otherwise
  unused export broke the old test. Type assertions remain checked by
  the package TypeScript command.
- **Remove runtime tests of erased types and fixtures.** The telemetry
  types-only import assertion and Team Mode command-types tests were
  removed. The latter's `session-1` expectation checked the literal
  returned by its own fixture, not a production command handler.
- **Remove already-implied imports.** Seven import-only assertions
  were removed from context formatting/scope/evals, telemetry
  context/UI, and Team Mode entrypoint/help tests. Each module was
  already statically imported and exercised in the same test file.
  Behavioural tests remain. Other standalone imports were not deleted
  merely for being small; resolving an import proves loading, not an
  absence of side effects.
- **Remove the progress-modal import-only test.** It still passed when
  the entire function body was removed. The test is now deleted; the
  [helper](../packages/pi-tui-modal/src/modal/progress.ts) and its
  public export remain unchanged.
- **Exercise configured rule boundaries.** The
  [coding-preferences tests](../packages/pi-coding-preferences/src/index.test.ts)
  now distinguish excluded tools and unrelated input fields from
  matching commands, and distinguish file paths from proposed content.
  These are user-configured boundaries, not new restrictions.
- **Exercise independent harness restrictions.** The
  [harness tests](../packages/pi-harness/src/index.test.ts) now cover
  forbidden paths inside an otherwise allowed directory, escape from
  project-wide scope, and a narrower scaffold test policy. Previously,
  allowed-path filtering could mask removal of another restriction.
- **Dispatch the actual lifecycle event.** The
  [tool-guidance fixture](../packages/pi-tool-guidance/src/index.test.ts)
  now captures only `before_agent_start`. Its old fixture invoked any
  registered callback, allowing a mutation to the wrong event name to
  survive. User-prompt preservation assertions remain.

## Verification after the rewrites

The same three non-modal source files were rerun with the repository's
Stryker setup and each package's related tests:

| Source                              | Killed | Timeout | Survived | No coverage |
| ----------------------------------- | -----: | ------: | -------: | ----------: |
| Coding preferences `src/index.ts`   |    179 |       1 |       37 |          21 |
| Harness `src/enforcement/policy.ts` |     67 |       0 |       18 |           0 |
| Tool guidance `src/index.ts`        |     71 |       0 |       13 |           5 |

The specific mutations removing command targeting, tool-name
filtering, the outside-cwd check, forbidden-path checking, independent
scaffold test restrictions, and correct lifecycle registration now
fail. The footer test also passes the compatible-addition experiment.
These checks establish the intended changes, not a requirement to
raise every remaining mutation score.

## Continued audit: context and Git UI

A further 489 mutants covered six source files, using the related
package tests. These findings are recommendations, not additional
implementation changes:

| Source                         | Killed | Timeout | Survived | No coverage |
| ------------------------------ | -----: | ------: | -------: | ----------: |
| Context `src/context-scope.ts` |      9 |       0 |       14 |           1 |
| Context `src/text.ts`          |    120 |      13 |      130 |          10 |
| Context `src/policy.ts`        |     43 |       0 |       37 |           0 |
| Git UI `src/git/errors.ts`     |      0 |       0 |        0 |          23 |
| Git UI `src/git/operations.ts` |     21 |       0 |        2 |          36 |
| Git UI `src/git/overview.ts`   |      0 |       0 |        0 |          30 |

`No coverage` means Stryker found no execution of the mutated code in
its dry run, not that it executed that mutant and observed a passing
test. Timeouts are reported separately from assertion failures.

### Rewrite: cover ordinary commits, not only amendments

In [Git operations](../packages/pi-git-ui/src/git/operations.ts),
changing `if (options.amend)` to `if (true)` survives. The relevant
[test](../packages/pi-git-ui/src/git.test.ts) exercises only
amendment. Keep that test, and add an ordinary-commit case that
verifies a new commit is created without replacing its parent. The
[documented controls](../packages/pi-git-ui/README.md#usage)
distinguish commit from amend; this is a real user-facing requirement,
not a preference about internal Git argument construction.

### Replace: Git loading smoke with operation-level protection

The standalone tests for
[errors](../packages/pi-git-ui/src/git/errors.test.ts),
[overview](../packages/pi-git-ui/src/git/overview.test.ts), and
[operations](../packages/pi-git-ui/src/git/operations.test.ts) only
import their modules. The selected suite did not execute overview or
error formatting, nor stage/unstage, bulk operations, or the
partial/conflicted-file toggle protections. Those are documented UI
capabilities, so the missing behavioural protection has a concrete
purpose.

Prefer tests of index/worktree effects in temporary repositories and
of useful overview/error output. Preserve the existing discard tests:
they verify unstaged changes can be discarded without destroying the
index. Do not replace those with tests of mocked Git argument lists.

The
[action-menu tests](../packages/pi-git-ui/src/stage-action-menu.test.ts)
were also inspected, but their source was not mutated in this run.
They assert labels/order without invoking callbacks. A useful rewrite
would verify that confirm invokes discard with the selected file and
cancel does not, rather than expanding a snapshot of menu ordering.

### Strengthen: test effective retention settings

In [context policy](../packages/pi-context/src/policy.ts), changing
`max_mb * 1024 * 1024` to `max_mb * 1024 / 1024` survives. The
[configuration test](../packages/pi-context/src/config.test.ts)
asserts `max_mb`, but not the effective byte cap. Add an assertion for
the derived byte limit, and exercise an explicit environment `false`
overriding a saved `true` purge setting.

Removing the `off` and `disabled` retention aliases also survives.
Those aliases are documented in the
[retention settings](../packages/pi-context/README.md#storage-scoping-and-retention),
so testing them protects an advertised way to disable cleanup. It does
not require locking in every undocumented parsing choice.

### Keep: lossless output and scope protection; allow algorithm changes

The [context store tests](../packages/pi-context/src/store.test.ts)
exercise full-content reconstruction, bounded chunks, retrieval scope,
and redacted captures through the actual store. Keep these integration
assertions even though the small helper test files look like smoke
tests.

Removing the preferred word/paragraph breakpoint candidates in
`text.ts` survives: splitting at the byte boundary can still preserve
content and chunk bounds. That is not automatically a missing test.
Decide whether a specific readability property is wanted before
freezing the current breakpoint algorithm or stopword list.

## Remaining audit limits

Default workflow preferences are not justified merely because tests
preserve them. Keep user overrides and corrective-edit tests; do not
turn choices such as command preferences into universal requirements.

Matching mutation results alone do not prove tests redundant. Some
survivors represent equivalent changes or flexible diagnostic wording.
Avoid exact-output snapshots solely to improve a score. The remaining
suite, including browser code and most worker/database coordination,
still needs intent review.
