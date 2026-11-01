---
title: Writing and searching docs
tags: [documentation, wiki0]
aliases: [Documentation workflow]
---

# Writing and searching docs

The documentation is ordinary Markdown, searchable and browsable with
[`@wiki0/cli`](https://www.npmjs.com/package/@wiki0/cli). No generated
site is needed to read or contribute to it.

## Find an existing section

Run from the repository root:

```bash
pnpx @wiki0/cli index
pnpx @wiki0/cli search "extension settings"
pnpx @wiki0/cli show docs/getting-started.md
pnpx @wiki0/cli context "local package development"
```

`search` returns one cited section per matching document. Pass a
returned citation to `show` to read the current text. `context`
combines search and section retrieval. `status` reports whether the
index is stale; rerun `index` after changes.

For a browser view:

```bash
pnpx @wiki0/cli ui
```

The command prints a local URL and reuses a running server. The CLI's
`--help` and `pnpx @wiki0/cli skill` describe the available commands
and upstream writing guidance.

[wiki0.toml](../wiki0.toml) indexes the root README, these guides,
package READMEs, and the website README. Its index is a rebuildable
cache outside the repository. This selection keeps local research
artifacts out of docs search; it is not a publication or secret-safety
boundary.

## Put information where readers need it

| Information                                            | Home                                                                     |
| ------------------------------------------------------ | ------------------------------------------------------------------------ |
| Package installation, commands, options, prerequisites | That package's README                                                    |
| Cross-package explanation and development workflows    | These guides                                                             |
| Generated badges and maintenance commands              | [Package README regions](./package-readmes.md)                           |
| Agent operating procedure                              | The matching [repository skill](../AGENTS.md#repository-specific-skills) |
| Upstream Pi features                                   | [Pi documentation](https://pi.dev)                                       |

Start by searching, then improve the existing section where practical.
Add a page when it answers a distinct reader question; link it from
[the docs index](./README.md). Avoid copying entire option tables from
package READMEs into guides.

## Describe behaviour, not invented rules

Implementation, executable checks, and guardrails determine current
behaviour; docs explain it. Explain what exists, why it matters, how
to use it, and where to change it. Link implementation claims to a
relevant README, source file, test, or public commit. Keep benchmark
numbers tied to their measured workload and limitations.

Current architecture is not a prohibition on future refactoring. A
historical workaround is not automatically a permanent policy. A
suggested idea is not an accepted requirement. If a proposal is worth
documenting, label it as an idea rather than presenting it as
implemented or decided.

Docs changes do not introduce approval queues, harness requirements,
package freezes, or new compatibility promises. Real safety and
compatibility details still belong in the relevant package docs; scope
them to the operation or feature they actually describe.

## Learn from session history without publishing it

Local recall tools can explain why code changed:

```bash
pnpx pirecall sync --json
pnpx pirecall recall '"upstream-first"' --project my-pi --json
pnpx omnirecall sync --json
pnpx omnirecall search "documentation" --project "$PWD" --json
```

For omnirecall, inspect sync status and coverage before treating a
search as complete. Its `outline` and `read` commands help narrow from
a session to specific evidence; use `--help` for options.

Treat retrieved conversations as research leads. Check the user's
actual request and tool evidence, then verify the current code.
Assistant summaries, including summaries pasted into conversations,
are not independent proof of a decision. Prefer public repository
sources as citations so readers can verify the published explanation.

Write a fresh, minimal explanation rather than pasting transcripts or
raw tool logs. Leave out credentials, authenticated URLs, local
account or host details, private project names, session identifiers,
database exports, and private messages. Use generic examples. Review
screenshots and sample output too: redaction tools are useful, but do
not guarantee that an artifact is safe to publish.

## Check the result

After the final docs edit:

```bash
pnpx @wiki0/cli check
pnpm run docs:check
```

wiki0 checks changed Markdown for link errors and review signals such
as repeated sections or additions-only edits. Fix errors; inspect
warnings and notices at the location they identify rather than
rewriting good docs to silence a heuristic. For a broader review,
`pnpx @wiki0/cli lint` inspects the indexed collection.

The repository check also validates npm-safe links and generated
package README regions. If you changed those regions, run
`pnpm run docs:sync` before checking. See
[Development](./development.md#choose-checks-for-the-change) for
validation when code or shared configuration also changed.
