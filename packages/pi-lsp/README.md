# @spences10/pi-lsp

<!-- package-readme:header:start -->

[![built with Vite+](https://img.shields.io/badge/built%20with-Vite+-646CFF?logo=vite&logoColor=white)](https://viteplus.dev)
[![tested with Vitest](https://img.shields.io/badge/tested%20with-Vitest-6E9F18?logo=vitest&logoColor=white)](https://vitest.dev)
[![npm version](https://img.shields.io/npm/v/@spences10/pi-lsp?color=CB3837&logo=npm&logoColor=white)](https://www.npmjs.com/package/@spences10/pi-lsp)
[![license](https://img.shields.io/npm/l/@spences10/pi-lsp)](https://www.npmjs.com/package/@spences10/pi-lsp)

![my-pi package preview](https://raw.githubusercontent.com/spences10/my-pi/main/assets/pi-package-preview.png)

<!-- package-readme:header:end -->

Prompt guidance uses Pi's named system-prompt sections. It coexists
with user `SYSTEM.md` and `APPEND_SYSTEM.md` files and other
extensions without replacing the complete prompt.

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
- Python via `python-lsp-server`, Basedpyright, or Pyright
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

### Python server selection

Python keeps `pylsp` when it is available, so installing another type
checker does not replace an existing pylsp setup or its plugins. When
pylsp is missing, project-local Basedpyright or Pyright takes priority
over global tools. The nearest project installation wins; within the
same directory, Basedpyright takes priority over Pyright. Global
fallback uses Basedpyright before Pyright.

Set `MY_PI_LSP_PYTHON_SERVER` to `pylsp`, `basedpyright`, or `pyright`
to select a specific backend. Unset it or use `auto` for the default
selection above. For example:

```bash
MY_PI_LSP_PYTHON_SERVER=pyright pi
```

An explicit selection never switches to another backend. Missing or
failed servers report an error and an installation hint. Install with
`pip install python-lsp-server`, `pip install basedpyright`, or
`pip install pyright`. Pyright-family servers use `--stdio`.

Python discovery checks executable files in ancestor `.venv/bin`
folders (`.venv/Scripts` on Windows), `node_modules/.bin`, and `PATH`.
Directories, broken links, and non-executable files are skipped. On
Windows, use native executables such as the `.exe` launchers from pip;
`.cmd` and `.bat` wrappers are not supported by the shell-free client.
`/lsp status` shows the selected backend and resolved command.

Server discovery does not select the Python interpreter used for
analysis. Configure the server's interpreter or virtual environment
settings separately when needed.

### Project-local language servers

Project-local binaries in `node_modules/.bin` and Python `.venv`
folders are selected automatically by the discovery rules above, in
both interactive and headless sessions. There is no separate
per-binary approval prompt or LSP trust store.

`MY_PI_LSP_PROJECT_BINARY` is no longer used. `/lsp status` shows the
selected backend and resolved command for running and idle servers.

### Language-server environment

LSP filters its language-server environment directly, passing only
`PATH`, `PI_CODING_AGENT_DIR`, home/user, locale (`LANG` and `LC_*`),
terminal/color, shell, temporary-directory, and CI variables by
default. Provider credentials, Pi session metadata, `NODE_OPTIONS`,
and other ambient variables are not inherited unless explicitly
allowlisted.

Use `MY_PI_LSP_ENV_ALLOWLIST=NAME,OTHER_NAME` to pass toolchain
configuration such as `RUSTUP_HOME`, `CARGO_HOME`, or `JAVA_HOME` when
needed. `MY_PI_CHILD_ENV_ALLOWLIST` remains supported; entries from
both lists are combined.

This reduces ambient credential exposure, but is not a sandbox:
language servers retain the current user's filesystem permissions.

## Tools

The extension registers LSP-backed Pi tools for:

- diagnostics
- hover
- definitions
- references
- document symbols

These tools let the model inspect types, find usages, and catch
diagnostics without guessing from text search alone.

A diagnostics result is clean only when the language server supplied
an empty list for the current document. If the server sends nothing
before `wait_ms` expires, the tool reports `validation incomplete`,
and `lsp_diagnostics_many` counts the file as `incomplete` and not as
`clean`. An incomplete result is not a pass: retry with a larger
`wait_ms` or use another check. Diagnostics for a closed document or
an earlier document version are ignored.

## Model reminder

When LSP tools are active, the extension reminds the model to use LSP
for code questions and validate changed files after the final relevant
edit, preferring `lsp_diagnostics_many` for batches. Passed
diagnostics can be reused for review, commit, and push if their inputs
are unchanged. Only affected or previously missing diagnostics need to
run; a commit or push request alone does not require another run.

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

`my-pi` includes this package.

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
