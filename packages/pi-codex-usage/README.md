# @spences10/pi-codex-usage

<!-- package-readme:header:start -->

[![built with Vite+](https://img.shields.io/badge/built%20with-Vite+-646CFF?logo=vite&logoColor=white)](https://viteplus.dev)
[![tested with Vitest](https://img.shields.io/badge/tested%20with-Vitest-6E9F18?logo=vitest&logoColor=white)](https://vitest.dev)
[![npm version](https://img.shields.io/npm/v/@spences10/pi-codex-usage?color=CB3837&logo=npm&logoColor=white)](https://www.npmjs.com/package/@spences10/pi-codex-usage)
[![license](https://img.shields.io/npm/l/@spences10/pi-codex-usage)](https://www.npmjs.com/package/@spences10/pi-codex-usage)

![my-pi package preview](https://raw.githubusercontent.com/spences10/my-pi/main/assets/pi-package-preview.png)

<!-- package-readme:header:end -->

Pi extension that publishes OpenAI Codex usage to the footer status
area.

It only shows status when the active model provider is `openai-codex`.
The extension reads `~/.pi/agent/auth.json` for `openai-codex.access`,
calls the Codex usage endpoint, and publishes a compact `codex-usage`
status for the existing `@spences10/pi-footer` renderer.

## Installation

<!-- package-readme:install:start -->

```bash
pi install npm:@spences10/pi-codex-usage
```

<!-- package-readme:install:end -->

Disable the built-in with:

```bash
my-pi --no-codex-usage
```

## Development

<!-- package-readme:development:start commands="check,test,build" -->

Package scripts build transitive workspace dependencies first, then
run local tools through Vite+ with `vp exec`.

```bash
pnpm --filter @spences10/pi-codex-usage run check
pnpm --filter @spences10/pi-codex-usage run test
pnpm --filter @spences10/pi-codex-usage run build
```

<!-- package-readme:development:end -->

## License

MIT
