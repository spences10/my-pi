# @spences10/pi-lsp

<!-- package-readme:header:start -->

[![built with Vite+](https://img.shields.io/badge/built%20with-Vite+-646CFF?logo=vite&logoColor=white)](https://viteplus.dev)
[![tested with Vitest](https://img.shields.io/badge/tested%20with-Vitest-6E9F18?logo=vitest&logoColor=white)](https://vitest.dev)
[![npm version](https://img.shields.io/npm/v/@spences10/pi-lsp?color=CB3837&logo=npm&logoColor=white)](https://www.npmjs.com/package/@spences10/pi-lsp)
[![license](https://img.shields.io/npm/l/@spences10/pi-lsp)](https://www.npmjs.com/package/@spences10/pi-lsp)

![my-pi package preview](https://raw.githubusercontent.com/spences10/my-pi/main/assets/pi-package-preview.png)

<!-- package-readme:header:end -->

Give agents precise code intelligence instead of guesswork. `pi-lsp`
exposes language-server diagnostics, hovers, definitions, references,
and symbols as Pi tools so models can validate edits and navigate
typed codebases accurately.

The hover, definition, and document-symbol tools prefer Pi's strict
JSON Schema sampling with closed, fully required schemas. LSP tools
with optional arguments use normal tool calling for provider
portability.

## Installation

<!-- package-readme:install:start -->

```bash
pi install npm:@spences10/pi-lsp
```

<!-- package-readme:install:end -->

Local development from this monorepo:

```bash
pnpm --filter @spences10/pi-lsp run build
pi install ./packages/pi-lsp
# or for one run only
pi -e ./packages/pi-lsp
```

## Required language servers

This package talks to language-server binaries installed globally on
`PATH` or locally in a project. Global installation makes one server
available across projects:

```bash
npm install -g typescript svelte-language-server
# or
pnpm add -g typescript svelte-language-server
```

Project-local development dependencies let a repository pin and share
specific server versions:

```bash
npm install -D typescript svelte-language-server
# or
pnpm add -D typescript svelte-language-server
```

For TypeScript 6 and earlier, add `typescript-language-server` to the
same global or project-local command. Volta users can install global
tools with `volta install typescript svelte-language-server`.

Supported server discovery includes:

- TypeScript 7 / JavaScript via the project-local native
  `tsc --lsp --stdio` server
- TypeScript 6 and earlier via `typescript-language-server --stdio`
- Svelte via `svelteserver`
- Python via `python-lsp-server`
- Go via `gopls`
- Rust via `rust-analyzer`
- Ruby via `solargraph`
- Java via `jdtls`
- Lua via `lua-language-server`

The TypeScript backend is selected by capability. A project-local
TypeScript installation takes priority. TypeScript 7 without
`lib/tsserver.js` uses its native `tsc` LSP, while classic project
installations use `typescript-language-server`. When a project does
not pin TypeScript, a TypeScript 7 `tsc` on `PATH` provides the native
LSP. `/lsp status` reports the selected backend and full command. A
TypeScript 7 native server that cannot start reports a specific setup
hint.

Project-local binaries in `node_modules/.bin` are detected before
global binaries, but are untrusted by default because they can execute
repo-controlled code. Interactive sessions prompt before starting a
project-local binary; headless sessions fall back to the global `PATH`
binary unless `MY_PI_LSP_PROJECT_BINARY=allow` or
`MY_PI_LSP_PROJECT_BINARY=trust` is set. `/lsp status` shows the
resolved binary path for running and idle servers.

Language servers receive a restricted child-process environment by
default. Use `MY_PI_LSP_ENV_ALLOWLIST=NAME,OTHER_NAME` or the shared
`MY_PI_CHILD_ENV_ALLOWLIST` to pass selected ambient variables
through.

## Tools

The extension registers LSP-backed Pi tools for:

- diagnostics
- hover
- definitions
- references
- document symbols

These tools let the model inspect types, find usages, and catch
diagnostics without guessing from text search alone.

## Model reminder

When LSP tools are active, the extension injects a small system prompt
reminder telling the model to use LSP for focused diagnostics, type
and symbol questions, definitions, references, and validation before
reporting completion. It also reminds the model to run diagnostics on
changed language-server-supported files before completion or commit,
preferring `lsp_diagnostics_many` for batches.

## Commands

```text
/lsp status
/lsp list
/lsp restart all
/lsp restart <language>
```

Use `/lsp status` to inspect active clients and `/lsp restart` after
dependency installs or language-server crashes.

Language servers stop after five minutes without an active LSP request
and start again on demand. Set `MY_PI_LSP_IDLE_TIMEOUT_MS` to a
positive timeout in milliseconds, or set it to `0` to keep idle
servers running until the Pi session exits.

## Using from a custom harness

```ts
import lsp from '@spences10/pi-lsp';

// pass `lsp` as an ExtensionFactory to your Pi runtime
```

For harnesses that need to provide their own language-server client
factory, use the named extension factory:

```ts
import { create_lsp_extension } from '@spences10/pi-lsp';

const lsp = create_lsp_extension({ create_client });
```

The package also exports `CreateLspExtensionOptions`,
`should_inject_lsp_prompt`, and `LspClientLike` for custom harnesses
and tests that need to share the same prompt-gating or client seam.

`my-pi` imports this package directly and enables it as the built-in
LSP extension.

## Development

<!-- package-readme:development:start commands="check,test,build" -->

Package scripts build transitive workspace dependencies first, then
run local tools through Vite+ with `vp exec`.

```bash
pnpm --filter @spences10/pi-lsp run check
pnpm --filter @spences10/pi-lsp run test
pnpm --filter @spences10/pi-lsp run build
```

<!-- package-readme:development:end -->

## License

MIT
