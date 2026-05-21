# @spences10/pi-tui-modal

[![built with Vite+](https://img.shields.io/badge/built%20with-Vite+-646CFF?logo=vite&logoColor=white)](https://viteplus.dev)
[![tested with Vitest](https://img.shields.io/badge/tested%20with-Vitest-6E9F18?logo=vitest&logoColor=white)](https://vitest.dev)
[![npm version](https://img.shields.io/npm/v/@spences10/pi-tui-modal?color=CB3837&logo=npm&logoColor=white)](https://www.npmjs.com/package/@spences10/pi-tui-modal)
[![license](https://img.shields.io/npm/l/@spences10/pi-tui-modal)](https://www.npmjs.com/package/@spences10/pi-tui-modal)

![my-pi package preview](https://raw.githubusercontent.com/spences10/my-pi/main/assets/pi-package-preview.png)

Build Pi overlays that feel consistent instead of one-off.
`pi-tui-modal` provides shared TUI modal primitives for pickers,
settings, prompts, confirmations, and scrollable text views used
across Pi extensions.

## Styling

Modals render with a full rounded border by default. Pass `style` to
change it:

```ts
style: {
	border: 'rounded';
} // 'rounded' | 'square' | 'line' | 'none'
```

`overlay_options` still controls size and placement. List and text
bodies automatically shrink to the current terminal height so modal
footers remain visible on small terminals.

## Helpers

- `show_picker_modal(ctx, options)` — select one item from a themed
  modal list.
- `show_settings_modal(ctx, options)` — toggle/update settings with
  optional search, metadata, and stable-width selection cursor.
- `show_text_modal(ctx, options)` — show scrollable read-only output.
- `show_input_modal(ctx, options)` — collect a single text value with
  IME-safe focus propagation.
- `show_confirm_modal(ctx, options)` — confirm/cancel destructive or
  replacing actions.

## Development

Package scripts build transitive workspace dependencies first, then
run local tools through Vite+ with `vp exec`.

```bash
pnpm --filter @spences10/pi-tui-modal run check
pnpm --filter @spences10/pi-tui-modal run test
pnpm --filter @spences10/pi-tui-modal run build
```
