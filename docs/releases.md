---
title: Package releases
tags: [releases, changesets, npm]
aliases: [Publishing packages]
---

# Package releases

The repository uses
[Changesets](https://github.com/changesets/changesets). The
[root scripts](../package.json) apply versions and publish packages;
[Changesets configuration](../.changeset/config.json) sets public
access and excludes the website package. The
[CI workflow](../.github/workflows/ci.yml) validates changes but does
not publish npm packages.

## Prepare release intent

Inspect pending Changesets:

```bash
pnpm changeset status
```

When preparing a release, add a Changeset for the affected packages
with `pnpm changeset`. Describe the user-visible change, including
migration details if behaviour breaks. The
[release skill](../.agents/skills/pi-release-workflow/SKILL.md)
describes this repository's version classification and validation.

For agent-assisted work, Changesets and commits are user-owned unless
explicitly requested; see
[AGENTS.md](../AGENTS.md#commit-and-changeset-ownership). That
ownership does not require a separate approval process for ordinary
implementation or docs edits.

## Apply versions and review

From the intended release state on `main`:

```bash
pnpm run version
pnpm run format
git diff
git status --short
```

`version` applies pending Changesets. Review package versions,
changelogs, and dependency changes before committing the intended
files. Keeping these steps separate avoids accidentally staging other
work in a shared checkout. See [Development](./development.md) for
validation; reuse successful checks when their inputs are unchanged.

## Publish

The owner publishes locally using an interactive npm login:

```bash
npm login
npm whoami
pnpm run release
```

The release script requires a clean working tree and index, builds the
packages, then runs `changeset publish`. Run it after the release
changes are committed and reviewed. Authentication output is local
operational information, not something to copy into public docs.

Publishing creates local package tags. Pushing commits and tags is a
separate action; the release script does not perform a Git push or
create a GitHub Release. The
[package sandbox skill](../.agents/skills/pi-package-sandbox-test/SKILL.md)
covers checking that published packages install and load outside the
workspace.
