# @spences10/pi-session-name

<!-- package-readme:header:start -->

[![built with Vite+](https://img.shields.io/badge/built%20with-Vite+-646CFF?logo=vite&logoColor=white)](https://viteplus.dev)
[![tested with Vitest](https://img.shields.io/badge/tested%20with-Vitest-6E9F18?logo=vitest&logoColor=white)](https://vitest.dev)
[![npm version](https://img.shields.io/npm/v/@spences10/pi-session-name?color=CB3837&logo=npm&logoColor=white)](https://www.npmjs.com/package/@spences10/pi-session-name)
[![license](https://img.shields.io/npm/l/@spences10/pi-session-name)](https://www.npmjs.com/package/@spences10/pi-session-name)

![my-pi package preview](https://raw.githubusercontent.com/spences10/my-pi/main/assets/pi-package-preview.png)

<!-- package-readme:header:end -->

## Session autonaming

Names an unnamed interactive session after a successful, fully settled
developer exchange, using Pi's selected model and configured
authentication. Names use lowercase kebab-case, at most 50 characters.

This makes one additional model request per session runtime, with at
most 2,000 characters each from the developer request and final
answer. Tool output, images, and thinking are excluded. This request
may incur provider cost; it is not an additional agent conversation
turn.

Manual names are never overwritten, including names set while
generation is pending. Session changes, branch changes, reload, and a
new run invalidate stale results. Requests are aborted after 15
seconds. Failed naming is best-effort: it warns without failing the
user's task.

Use upstream `/name <name>` for manual naming. Use `/session-name` (or
`/session-name --auto`) to retry generation for an unnamed session
after a completed exchange. Automatic naming is TUI-only; explicit
generation uses the selected model in any mode.

Bundled into my-pi as `session-name`. Disable it with
`/extensions disable session-name` to avoid automatic naming requests.
Reloading an unnamed session permits another automatic attempt.

## Install

<!-- package-readme:install:start -->

```bash
pi install npm:@spences10/pi-session-name
```

<!-- package-readme:install:end -->

## Development

<!-- package-readme:development:start commands="check,test,build" -->

Package scripts build transitive workspace dependencies first, then
run local tools through Vite+ with `vp exec`.

```bash
pnpm --filter @spences10/pi-session-name run check
pnpm --filter @spences10/pi-session-name run test
pnpm --filter @spences10/pi-session-name run build
```

<!-- package-readme:development:end -->

## License

MIT
