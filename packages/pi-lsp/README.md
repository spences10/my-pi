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

All seven LSP tools use deterministic object schemas and prefer Pi's
strict JSON Schema sampling. Pi falls back to normal tool calling when
the active provider or model does not support strict tools.

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

This package talks to language-server binaries installed in your
project or on `PATH`. For TypeScript, JavaScript, and Svelte projects:

```bash
pnpm add -D typescript typescript-language-server svelte-language-server
```

Supported server discovery includes:

- TypeScript / JavaScript via `typescript-language-server`
- Svelte via `svelteserver`
- Python via `python-lsp-server`
- Go via `gopls`
- Rust via `rust-analyzer`
- Ruby via `solargraph`
- Java via `jdtls`
- Lua via `lua-language-server`

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
