# @spences10/pi-recall

[![npm version](https://img.shields.io/npm/v/@spences10/pi-recall?color=CB3837&logo=npm)](https://www.npmjs.com/package/@spences10/pi-recall)
[![built with Vite+](https://img.shields.io/badge/built%20with-Vite+-646CFF?logo=vite&logoColor=white)](https://viteplus.dev)
[![tested with Vitest](https://img.shields.io/badge/tested%20with-Vitest-6E9F18?logo=vitest&logoColor=white)](https://vitest.dev)

Pi extension that reminds the model to use `pirecall` for past-session
context and syncs local recall data.

Maintained in the `my-pi` Vite+ workspace and tested with Vitest.

## Installation

```bash
pi install npm:@spences10/pi-recall
```

Local development from this monorepo:

```bash
pnpm --filter @spences10/pi-recall run build
pi install ./packages/pi-recall
# or for one run only
pi -e ./packages/pi-recall
```

## What it does

- runs `npx pirecall sync --json` in the background on session start
  when `~/.pi/pirecall.db` exists
- runs `npx pirecall sync --json` again on session shutdown
- injects a system reminder telling the model to use
  `pnpx pirecall ... --json` or `npx pirecall ... --json`
- adds no slash commands and no custom tools

## Model reminder

The injected reminder tells the model to use `pirecall` when:

- the user references prior work
- previous session context would prevent repeated work
- project history or decisions matter

Useful commands:

```bash
pnpx pirecall sync --json
pnpx pirecall recall "auth refactor" --json
pnpx pirecall search "prompt presets" --json
pnpx pirecall sessions --json
pnpx pirecall stats --json
```

Use `npx` instead of `pnpx` outside pnpm-oriented environments.

## Using from a custom harness

```ts
import recall from '@spences10/pi-recall';

// pass `recall` as an ExtensionFactory to your Pi runtime
```

`my-pi` imports this package directly and enables it as the built-in
recall reminder.

## Development

```bash
pnpm --filter @spences10/pi-recall run check
pnpm --filter @spences10/pi-recall run test
pnpm --filter @spences10/pi-recall run build
```

## License

MIT
