# @spences10/pi-tool-guidance

<!-- package-readme:header:start -->

[![built with Vite+](https://img.shields.io/badge/built%20with-Vite+-646CFF?logo=vite&logoColor=white)](https://viteplus.dev)
[![tested with Vitest](https://img.shields.io/badge/tested%20with-Vitest-6E9F18?logo=vitest&logoColor=white)](https://vitest.dev)
[![npm version](https://img.shields.io/npm/v/@spences10/pi-tool-guidance?color=CB3837&logo=npm&logoColor=white)](https://www.npmjs.com/package/@spences10/pi-tool-guidance)
[![license](https://img.shields.io/npm/l/@spences10/pi-tool-guidance)](https://www.npmjs.com/package/@spences10/pi-tool-guidance)

![my-pi package preview](https://raw.githubusercontent.com/spences10/my-pi/main/assets/pi-package-preview.png)

<!-- package-readme:header:end -->

## Tool workflow guidance

Distributes native Pi skills and concise system-prompt reminders for
nopeek, Omnisearch, and SQLite. It does not depend on the maintainer's
local files.

## What ships

- `my-pi-nopeek`: one-shot credential loading, explicit key
  allowlists, separate-shell limitations, and output disclosure
  precautions.
- `my-pi-omnisearch`: tool discovery, source extraction, and verified
  research.
- `my-pi-sqlite`: schema inspection, bounded queries, backups,
  transactions, and respecting database safety gates.

Pi advertises these native skills and loads their full contents on
demand. Invoke `/skill:my-pi-nopeek`, `/skill:my-pi-omnisearch`, or
`/skill:my-pi-sqlite` to request one explicitly.

Essential reminders are contributed through a named structured prompt
section. Secret guidance is active with shell access; MCP guidance is
conditional on reachable tools or Pi's configured indirect-server
listing. Both codemode and tool-search exposure work without requiring
direct tool declarations.

## User configuration remains yours

The package does not install the nopeek CLI, start MCP servers, set
provider credentials, or modify `SYSTEM.md`, `APPEND_SYSTEM.md`, or
`mcp.json`. Configure the required tools through Pi's normal
mechanisms. Native prompt files coexist with the package's section;
disabling this extension removes its bundled resources on reload in
my-pi.

Instructions are guidance, not a security boundary. Child processes
can still print secrets; redaction and database permission enforcement
remain separate. Third-party extensions that force a complete prompt
can hide later structured sections; prefer Pi's structured prompt API.

Bundled into my-pi as `tool-guidance`. Use
`/extensions disable tool-guidance` to remove its reminders and
bundled skills on reload. The package manifest exposes the same skills
in standalone Pi.

## Install

<!-- package-readme:install:start -->

```bash
pi install npm:@spences10/pi-tool-guidance
```

<!-- package-readme:install:end -->

## Development

<!-- package-readme:development:start commands="check,test,build" -->

Package scripts build transitive workspace dependencies first, then
run local tools through Vite+ with `vp exec`.

```bash
pnpm --filter @spences10/pi-tool-guidance run check
pnpm --filter @spences10/pi-tool-guidance run test
pnpm --filter @spences10/pi-tool-guidance run build
```

<!-- package-readme:development:end -->

## License

MIT
