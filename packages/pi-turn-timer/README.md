# @spences10/pi-turn-timer

<!-- package-readme:header:start -->

[![built with Vite+](https://img.shields.io/badge/built%20with-Vite+-646CFF?logo=vite&logoColor=white)](https://viteplus.dev)
[![tested with Vitest](https://img.shields.io/badge/tested%20with-Vitest-6E9F18?logo=vitest&logoColor=white)](https://vitest.dev)
[![npm version](https://img.shields.io/npm/v/@spences10/pi-turn-timer?color=CB3837&logo=npm&logoColor=white)](https://www.npmjs.com/package/@spences10/pi-turn-timer)
[![license](https://img.shields.io/npm/l/@spences10/pi-turn-timer)](https://www.npmjs.com/package/@spences10/pi-turn-timer)

![my-pi package preview](https://raw.githubusercontent.com/spences10/my-pi/main/assets/pi-package-preview.png)

<!-- package-readme:header:end -->

## Turn timing

Shows live elapsed time through Pi's existing working indicator and
persists completion durations as session entries. No model calls are
made.

The timer starts at `agent_start` and finishes at `agent_settled`,
spanning retries, compaction, and queued continuations rather than
resetting at each low-level run. Aborted interactions display
“Stopped” rather than “Completed”. Reload and session shutdown clear
the timer and restore Pi's working message. Incomplete work is not
attributed to the next session.

Interactive mode shows the live clock. JSON, print, and RPC modes
record durations without changing terminal UI. Existing `turn-timer`
entries remain renderable after resuming a session.

Bundled into my-pi as `turn-timer`. Disable it with
`/extensions disable turn-timer`; changes apply on reload. The
working-message slot is shared with other extensions, so avoid
enabling another extension that owns that same slot.

## Install

<!-- package-readme:install:start -->

```bash
pi install npm:@spences10/pi-turn-timer
```

<!-- package-readme:install:end -->

## Development

<!-- package-readme:development:start commands="check,test,build" -->

Package scripts build transitive workspace dependencies first, then
run local tools through Vite+ with `vp exec`.

```bash
pnpm --filter @spences10/pi-turn-timer run check
pnpm --filter @spences10/pi-turn-timer run test
pnpm --filter @spences10/pi-turn-timer run build
```

<!-- package-readme:development:end -->

## License

MIT
