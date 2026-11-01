---
name: wiki0
# prettier-ignore
description: Use when finding, rebuilding, or editing this project's documentation with pnpx @wiki0/cli, including evidence checks and public-safe session-history research.
---

# Project docs with wiki0

Use `pnpx @wiki0/cli`, not the wiki0 MCP tools, for this project.

## Find and verify

1. Run `pnpx @wiki0/cli status`; run `index` if missing or stale.
2. Run `pnpx @wiki0/cli search "<question>"`, then `show <citation>`.
3. Check current package READMEs and code before describing behaviour.
   Edit an existing section when it already answers the question.

## Write useful public docs

- Explain the current behaviour and how to work with it. Link material
  claims to a public README, source file, test, or commit.
- Use recall history as research, not text to paste. Verify user
  intent and tool evidence; assistant summaries are not decisions.
- Keep credentials, private transcripts, authenticated URLs, local
  identities, and internal artifacts out of published docs.
- Behaviour is enforced by implementation, checks, and guardrails, not
  prose. Describe architecture without freezing it. Do not invent
  approval steps, work restrictions, compatibility layers, or
  mandatory harnesses. Label ideas as ideas and scope real caveats
  precisely.
- Keep package behaviour in package READMEs; link instead of copying.
  For details, read `docs/documentation.md` from the repository root.

## Validate

Run `pnpx @wiki0/cli check` and `pnpm run docs:check` after the final
edit. Fix errors and review focused warnings; notices are prompts for
judgment, not reasons to add process. Follow the repository's
`pi-validation-flow` skill for other changes.
