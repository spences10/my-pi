# @spences10/pi-confirm-destructive

<!-- package-readme:header:start -->

[![built with Vite+](https://img.shields.io/badge/built%20with-Vite+-646CFF?logo=vite&logoColor=white)](https://viteplus.dev)
[![tested with Vitest](https://img.shields.io/badge/tested%20with-Vitest-6E9F18?logo=vitest&logoColor=white)](https://vitest.dev)
[![npm version](https://img.shields.io/npm/v/@spences10/pi-confirm-destructive?color=CB3837&logo=npm&logoColor=white)](https://www.npmjs.com/package/@spences10/pi-confirm-destructive)
[![license](https://img.shields.io/npm/l/@spences10/pi-confirm-destructive)](https://www.npmjs.com/package/@spences10/pi-confirm-destructive)

![my-pi package preview](https://raw.githubusercontent.com/spences10/my-pi/main/assets/pi-package-preview.png)

<!-- package-readme:header:end -->

Stop destructive shell commands before they surprise you.
`pi-confirm-destructive` adds a Git-aware confirmation layer for
deletes, resets, force pushes, and other risky actions so agents pause
before changing or losing work.

## Installation

<!-- package-readme:install:start -->

```bash
pi install npm:@spences10/pi-confirm-destructive
```

<!-- package-readme:install:end -->

Local development from this monorepo:

```bash
pnpm --filter @spences10/pi-confirm-destructive run build
pi install ./packages/pi-confirm-destructive
# or for one run only
pi -e ./packages/pi-confirm-destructive
```

## What it does

The extension intercepts Pi `tool_call` and `user_bash` events before
they run and asks for confirmation when an action may destroy data
that Git cannot restore.

It tokenizes shell command intent across newlines, pipelines, command
substitutions, groups, and common wrappers such as `sudo`, `env`,
`command`, `xargs`, and `sh -c`. It allows common refactor operations
on clean tracked files without prompting, while guarding:

- untracked, ignored, or dirty file deletes and overwrites
- repository-root deletion, including the otherwise clean `.git`
  directory and local-only branches, stashes, and metadata
- overwrite redirections and broad destructive shell commands such as
  `find -delete`/destructive `-exec`, `sed -i`, `git clean`,
  `rsync --delete`, `truncate`, `dd`, and disk tools
- destructive Git operations including stash deletion, forced branch
  deletion, remote-ref deletion, hard resets, and force pushes
- destructive Prisma and database CLI commands, including `dropdb` and
  Redis flushes
- Docker system pruning, Terraform destroy, recursive S3 removal, and
  Kubernetes deletion
- custom/MCP tools with destructive names such as `delete`, `drop`,
  `execute_write_query`, or `execute_schema_query`

In interactive mode the prompt offers:

- `Allow once`
- `Allow similar for this session`
- `Block`

In non-interactive mode destructive actions are blocked by default.

This is a confirmation guard, not a shell sandbox. Shell aliases,
dynamically assembled command names, custom executables, and novel
command families can still hide destructive intent. Keep important
work committed and backed up, and use OS/container isolation when
executing untrusted commands.

## Using from a custom harness

```ts
import confirm_destructive from '@spences10/pi-confirm-destructive';

// pass `confirm_destructive` as an ExtensionFactory to your Pi runtime
```

`my-pi` imports this package directly and enables it as the built-in
confirm-destructive guard.

## Development

<!-- package-readme:development:start commands="check,test,build" -->

Package scripts build transitive workspace dependencies first, then
run local tools through Vite+ with `vp exec`.

```bash
pnpm --filter @spences10/pi-confirm-destructive run check
pnpm --filter @spences10/pi-confirm-destructive run test
pnpm --filter @spences10/pi-confirm-destructive run build
```

<!-- package-readme:development:end -->

## License

MIT
