# @spences10/pi-git-ui

[![built with Vite+](https://img.shields.io/badge/built%20with-Vite+-646CFF?logo=vite&logoColor=white)](https://viteplus.dev)
[![tested with Vitest](https://img.shields.io/badge/tested%20with-Vitest-6E9F18?logo=vitest&logoColor=white)](https://vitest.dev)
[![npm version](https://img.shields.io/npm/v/@spences10/pi-git-ui?color=CB3837&logo=npm&logoColor=white)](https://www.npmjs.com/package/@spences10/pi-git-ui)
[![license](https://img.shields.io/npm/l/@spences10/pi-git-ui)](https://www.npmjs.com/package/@spences10/pi-git-ui)

![my-pi package preview](https://raw.githubusercontent.com/spences10/my-pi/main/assets/pi-package-preview.png)

Review and commit changes from inside Pi without context-switching to
a separate Git client. `pi-git-ui` provides a focused staging, diff
review, and commit modal designed for agent-assisted coding workflows.

## Usage

```bash
pi install npm:@spences10/pi-git-ui
```

Then run:

```text
/git-ui
```

Controls:

- `↑`/`↓` or `j`/`k` — move file selection
- `/` — filter files by path, state, or status code
- `enter` — open contextual actions for the selected file
- `?` — show grouped keyboard help
- `←`/`→` or `h`/`l` — scroll the diff preview
- `n`/`p` — move between diff hunks
- `[`/`]` — move between changed lines
- `space` — safely stage/unstage selected file; disabled for
  partial/conflicted files
- `s` — stage selected file explicitly
- `x` — unstage selected file explicitly
- `S` — stage selected hunk
- `X` — unstage selected hunk
- `+` — stage selected changed line
- `-` — unstage selected changed line
- `c` — commit staged changes with a Conventional Commit helper or raw
  message
- `m` — amend the last commit with staged changes
- `g` — show repository overview with branches, recent commits,
  stashes, and remotes
- `a` — safely stage all; blocked if partial/conflicted files exist
- `A` — force stage all
- `u` — unstage all
- actions menu → `discard file` — confirm and discard unstaged file
  changes
- `r` — refresh
- `esc`/`q` — close

## Development

Package scripts build transitive workspace dependencies first, then
run local tools through Vite+ with `vp exec`.

```bash
pnpm --filter @spences10/pi-git-ui run check
pnpm --filter @spences10/pi-git-ui run test
pnpm --filter @spences10/pi-git-ui run build
```
