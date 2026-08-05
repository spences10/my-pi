# @spences10/pi-kimi-usage

<!-- package-readme:header:start -->

[![built with Vite+](https://img.shields.io/badge/built%20with-Vite+-646CFF?logo=vite&logoColor=white)](https://viteplus.dev)
[![tested with Vitest](https://img.shields.io/badge/tested%20with-Vitest-6E9F18?logo=vitest&logoColor=white)](https://vitest.dev)
[![npm version](https://img.shields.io/npm/v/@spences10/pi-kimi-usage?color=CB3837&logo=npm&logoColor=white)](https://www.npmjs.com/package/@spences10/pi-kimi-usage)
[![license](https://img.shields.io/npm/l/@spences10/pi-kimi-usage)](https://www.npmjs.com/package/@spences10/pi-kimi-usage)

![my-pi package preview](https://raw.githubusercontent.com/spences10/my-pi/main/assets/pi-package-preview.png)

<!-- package-readme:header:end -->

Pi extension that publishes Kimi For Coding usage to the footer status
area.

It only shows status when the active model provider is `kimi-coding`.
The extension reads `~/.pi/agent/auth.json` for the `kimi-coding`
credential (OAuth `access` token or API key, falling back to the
`KIMI_API_KEY` environment variable), calls the Kimi Code usage
endpoint (`GET https://api.kimi.com/coding/v1/usages`), and publishes
a compact `kimi-usage` status for the existing `@spences10/pi-footer`
renderer.

The status shows the 5-hour rolling window first, then the weekly
quota, each as used percent with a compact reset time, e.g.
`kimi 4h 7% · 5d 4%`. The footer shows `kimi ?` when the credential is
expired or the endpoint is unreachable; OAuth tokens are refreshed by
Pi's built-in provider and picked up here on the next poll.

## Installation

<!-- package-readme:install:start -->

```bash
pi install npm:@spences10/pi-kimi-usage
```

<!-- package-readme:install:end -->

Disable the built-in with:

```bash
my-pi --no-kimi-usage
```

## Development

<!-- package-readme:development:start commands="check,test,build" -->

Package scripts build transitive workspace dependencies first, then
run local tools through Vite+ with `vp exec`.

```bash
pnpm --filter @spences10/pi-kimi-usage run check
pnpm --filter @spences10/pi-kimi-usage run test
pnpm --filter @spences10/pi-kimi-usage run build
```

<!-- package-readme:development:end -->

## License

MIT
