# @spences10/pi-lsp

[![built with vite+](https://img.shields.io/badge/built%20with-Vite+-646CFF?logo=vite&logoColor=white)](https://viteplus.dev)
[![tested with vitest](https://img.shields.io/badge/tested%20with-Vitest-6E9F18?logo=vitest&logoColor=white)](https://vitest.dev)

Pi extension that exposes Language Server Protocol diagnostics and
symbol tools to the model.

## Install

```bash
pi install npm:@spences10/pi-lsp
```

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
reporting completion.

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

`my-pi` imports this package directly and enables it as the built-in
LSP extension.

## Development

```bash
pnpm --filter @spences10/pi-lsp run check
pnpm --filter @spences10/pi-lsp run test
pnpm --filter @spences10/pi-lsp run build
```

## License

MIT
