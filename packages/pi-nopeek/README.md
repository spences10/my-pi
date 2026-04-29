# @spences10/pi-nopeek

[![npm version](https://img.shields.io/npm/v/@spences10/pi-nopeek?color=CB3837&logo=npm)](https://www.npmjs.com/package/@spences10/pi-nopeek)
[![built with Vite+](https://img.shields.io/badge/built%20with-Vite+-646CFF?logo=vite&logoColor=white)](https://viteplus.dev)
[![tested with Vitest](https://img.shields.io/badge/tested%20with-Vitest-6E9F18?logo=vitest&logoColor=white)](https://vitest.dev)

Pi extension that reminds the model to use `nopeek` for secret-safe
environment loading.

Maintained in the `my-pi` Vite+ workspace and tested with Vitest.

## Installation

```bash
pi install npm:@spences10/pi-nopeek
```

Local development from this monorepo:

```bash
pnpm --filter @spences10/pi-nopeek run build
pi install ./packages/pi-nopeek
# or for one run only
pi -e ./packages/pi-nopeek
```

## What it does

The extension injects a system reminder telling the model to use
`pnpx nopeek ...` or `npx nopeek ...` when it needs credentials from:

- `.env`
- `.env.*`
- `.tfvars`
- `.tfvars.json`
- cloud CLI profiles or service credentials

It adds no slash commands and no custom tools.

## Model reminder

The injected reminder tells the model to:

- prefer `pnpx nopeek load .env --only KEY_NAME` over reading `.env`
- use loaded variables by name in later shell commands
- use `pnpx nopeek list` and `pnpx nopeek status` to inspect key names
  without values
- use `pnpx nopeek audit` to scan for exposed secrets and gitignore
  coverage
- avoid printing, echoing, catting, grepping, or pasting secret values
  into context

Example safe workflow:

```bash
pnpx nopeek load .env --only DATABASE_URL
psql "$DATABASE_URL" -c 'select 1'
```

Use `npx` instead of `pnpx` outside pnpm-oriented environments.

## Using from a custom harness

```ts
import nopeek from '@spences10/pi-nopeek';

// pass `nopeek` as an ExtensionFactory to your Pi runtime
```

`my-pi` imports this package directly and enables it as the built-in
nopeek reminder.

## Development

```bash
pnpm --filter @spences10/pi-nopeek run check
pnpm --filter @spences10/pi-nopeek run test
pnpm --filter @spences10/pi-nopeek run build
```

## License

MIT
