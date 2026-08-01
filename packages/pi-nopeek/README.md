# @spences10/pi-nopeek

<!-- package-readme:header:start -->

[![built with Vite+](https://img.shields.io/badge/built%20with-Vite+-646CFF?logo=vite&logoColor=white)](https://viteplus.dev)
[![tested with Vitest](https://img.shields.io/badge/tested%20with-Vitest-6E9F18?logo=vitest&logoColor=white)](https://vitest.dev)
[![npm version](https://img.shields.io/npm/v/@spences10/pi-nopeek?color=CB3837&logo=npm&logoColor=white)](https://www.npmjs.com/package/@spences10/pi-nopeek)
[![license](https://img.shields.io/npm/l/@spences10/pi-nopeek)](https://www.npmjs.com/package/@spences10/pi-nopeek)

![my-pi package preview](https://raw.githubusercontent.com/spences10/my-pi/main/assets/pi-package-preview.png)

<!-- package-readme:header:end -->

Reduce accidental secret disclosure during credential-dependent
commands. `pi-nopeek` reminds agents to use the `nopeek` CLI instead
of reading or pasting `.env`, cloud-token, and database credential
values into model-visible input.

## Installation

<!-- package-readme:install:start -->

```bash
pi install npm:@spences10/pi-nopeek
```

<!-- package-readme:install:end -->

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

- lead with `pnpx nopeek run ... -- <command>` in Pi, where each tool
  call starts an ephemeral shell
- select only the keys required by the child command
- use `nopeek load` only when the harness confirms persistent env-file
  injection, or when source/evaluation and execution occur in the same
  trusted shell
- use `pnpx nopeek list` and `pnpx nopeek status` to inspect key names
  without values
- use `pnpx nopeek audit` to scan for exposed secrets and gitignore
  coverage
- avoid printing, echoing, catting, grepping, tracing, or pasting
  secret values into model-visible output

Example one-shot workflow:

```bash
pnpx nopeek run .env --only DATABASE_URL -- \
  sh -c 'psql "$DATABASE_URL" -c "select 1"'
```

`run` gives selected values only to its child process. That child can
still disclose values through stdout, stderr, shell tracing, `env`, or
`printenv`. A `source_file` produced by `load` does not carry into an
unrelated Pi tool call.

`pi-redact` is a separate, best-effort last-mile safety net. It cannot
guarantee arbitrary child output is safe. Review nopeek's
[threat model and non-goals](https://github.com/spences10/nopeek#threat-model-and-non-goals)
before choosing a workflow.

Use `npx` instead of `pnpx` outside pnpm-oriented environments.

## Using from a custom harness

```ts
import nopeek from '@spences10/pi-nopeek';

// pass `nopeek` as an ExtensionFactory to your Pi runtime
```

`my-pi` imports this package directly and enables it as the built-in
nopeek reminder.

## Development

<!-- package-readme:development:start commands="check,test,build" -->

Package scripts build transitive workspace dependencies first, then
run local tools through Vite+ with `vp exec`.

```bash
pnpm --filter @spences10/pi-nopeek run check
pnpm --filter @spences10/pi-nopeek run test
pnpm --filter @spences10/pi-nopeek run build
```

<!-- package-readme:development:end -->

## License

MIT
