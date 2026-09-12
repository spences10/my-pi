# @spences10/pi-starfield

<!-- package-readme:header:start -->

[![built with Vite+](https://img.shields.io/badge/built%20with-Vite+-646CFF?logo=vite&logoColor=white)](https://viteplus.dev)
[![tested with Vitest](https://img.shields.io/badge/tested%20with-Vitest-6E9F18?logo=vitest&logoColor=white)](https://vitest.dev)
[![npm version](https://img.shields.io/npm/v/@spences10/pi-starfield?color=CB3837&logo=npm&logoColor=white)](https://www.npmjs.com/package/@spences10/pi-starfield)
[![license](https://img.shields.io/npm/l/@spences10/pi-starfield)](https://www.npmjs.com/package/@spences10/pi-starfield)

![my-pi package preview](https://raw.githubusercontent.com/spences10/my-pi/main/assets/pi-package-preview.png)

<!-- package-readme:header:end -->

A shaded input with quiet, twinkling stars and short, original quotes
for **my-pi**. Included by default in interactive `my-pi` sessions, or
install it as an extension in upstream Pi 0.85.0 or newer.

## Installation

<!-- package-readme:install:start -->

```bash
pi install npm:@spences10/pi-starfield
```

<!-- package-readme:install:end -->

Local development from this monorepo:

```bash
pnpm --filter @spences10/pi-starfield run build
pi install ./packages/pi-starfield
# or for one run only
pi -e ./packages/pi-starfield
```

## What it does

- The input keeps the active theme's `userMessageBg` background while
  empty or typing. It starts at three shaded rows and grows with text.
- Single-dot Braille stars stay in fixed cells with dim, slow 9–14
  second pulses. Typing does not stop or restart the animation.
- Stars remain in the padding above and below typed text. Text rows,
  cursor cells, scroll indicators, and autocomplete stay clear.
- Twelve original quotes use a `my-pi` label in the empty input. A
  random quote starts each editor session; the next quote appears when
  typed input is cleared or sent. Quotes do not change on an idle
  timer and are never submitted.
- Pasted text, history, shortcuts, and autocomplete keep Pi's input
  and layout behavior. Scroll indicators remain visible for long
  input.
- Animation requests a normal Pi render every 150 ms while the editor
  has focus. It stops when another component takes focus, the editor
  is replaced, or the session shuts down. No raw terminal writes.
- Theme changes apply on the next render. Stars blend `muted` toward
  `userMessageBg` in truecolor themes. Other palettes use `dim`, which
  is also used for quote text.
- `NO_COLOR` and `TERM=dumb` disable the custom editor. Print, JSON,
  and RPC modes do not install it.
- Another custom editor is not replaced. Disable the other extension
  first, or disable this one when using a different editor.

## Controls

```text
/starfield on      Animate stars (default)
/starfield static  Keep a still star field, with no animation timer
/starfield off     Restore Pi's normal editor
```

The choice is saved globally in `~/.pi/agent/my-pi-settings.json` (or
in the configured Pi agent directory), under:

```json
{
	"packages": {
		"pi-starfield": { "mode": "static" }
	}
}
```

In `my-pi`, `--no-starfield` disables the extension for one launch.

## Using from a custom harness

```ts
import starfield from '@spences10/pi-starfield';

// Pass starfield as an ExtensionFactory to your Pi runtime.
```

`my-pi` imports this package directly and enables it as the built-in
starfield extension.

## Local testing

From the repository root:

```bash
pnpm run build
node dist/index.js
```

Try typing, clearing the input, pasting multiple lines, history keys,
slash completion, a theme change, a narrow terminal, and the three
`/starfield` modes. The local terminal and font determine the final
dot appearance.

## Design reference

The effect was checked against OpenAI Codex's
[composer sparkle source](https://github.com/openai/codex/blob/main/codex-rs/tui/src/bottom_pane/chat_composer/sparkle.rs).
This implementation uses its own cell hash and pulse function, with
Pi's `CustomEditor` and render scheduler. Unlike Codex's
model-specific, time-limited flourish, it works with any model and
continues while typing.

## Development

<!-- package-readme:development:start commands="check,test,build" -->

Package scripts build transitive workspace dependencies first, then
run local tools through Vite+ with `vp exec`.

```bash
pnpm --filter @spences10/pi-starfield run check
pnpm --filter @spences10/pi-starfield run test
pnpm --filter @spences10/pi-starfield run build
```

<!-- package-readme:development:end -->

## License

MIT
