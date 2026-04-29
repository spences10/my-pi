# @spences10/pi-confirm-destructive

[![npm version](https://img.shields.io/npm/v/@spences10/pi-confirm-destructive?color=CB3837&logo=npm)](https://www.npmjs.com/package/@spences10/pi-confirm-destructive)
[![built with Vite+](https://img.shields.io/badge/built%20with-Vite+-646CFF?logo=vite&logoColor=white)](https://viteplus.dev)
[![tested with Vitest](https://img.shields.io/badge/tested%20with-Vitest-6E9F18?logo=vitest&logoColor=white)](https://vitest.dev)

Git-aware destructive action guard for the Pi coding agent.

Maintained in the `my-pi` Vite+ workspace and tested with Vitest.

## Installation

```bash
pi install npm:@spences10/pi-confirm-destructive
```

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

It allows common refactor operations on clean tracked files without
prompting, while guarding:

- untracked file deletes or overwrites
- tracked files with uncommitted changes
- broad destructive shell commands such as `find -delete`,
  `git clean`, `rsync --delete`, `truncate`, `dd`, and disk tools
- destructive Prisma commands such as `prisma migrate reset` and
  `prisma db push --force-reset`
- destructive database CLI calls through `psql`, `mysql`, `mariadb`,
  or `sqlite3`
- custom/MCP tools with destructive names such as `delete`, `drop`,
  `execute_write_query`, or `execute_schema_query`

In interactive mode the prompt offers:

- `Allow once`
- `Allow similar for this session`
- `Block`

In non-interactive mode destructive actions are blocked by default.

## Using from a custom harness

```ts
import confirm_destructive from '@spences10/pi-confirm-destructive';

// pass `confirm_destructive` as an ExtensionFactory to your Pi runtime
```

`my-pi` imports this package directly and enables it as the built-in
confirm-destructive guard.

## Development

```bash
pnpm --filter @spences10/pi-confirm-destructive run check
pnpm --filter @spences10/pi-confirm-destructive run test
pnpm --filter @spences10/pi-confirm-destructive run build
```

## License

MIT
