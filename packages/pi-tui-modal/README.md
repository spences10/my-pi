# @spences10/pi-tui-modal

<!-- package-readme:header:start -->

[![built with Vite+](https://img.shields.io/badge/built%20with-Vite+-646CFF?logo=vite&logoColor=white)](https://viteplus.dev)
[![tested with Vitest](https://img.shields.io/badge/tested%20with-Vitest-6E9F18?logo=vitest&logoColor=white)](https://vitest.dev)
[![npm version](https://img.shields.io/npm/v/@spences10/pi-tui-modal?color=CB3837&logo=npm&logoColor=white)](https://www.npmjs.com/package/@spences10/pi-tui-modal)
[![license](https://img.shields.io/npm/l/@spences10/pi-tui-modal)](https://www.npmjs.com/package/@spences10/pi-tui-modal)

![my-pi package preview](https://raw.githubusercontent.com/spences10/my-pi/main/assets/pi-package-preview.png)

<!-- package-readme:header:end -->

Build Pi overlays that feel consistent instead of one-off.
`pi-tui-modal` provides shared TUI modal primitives for pickers,
settings, prompts, confirmations, and scrollable text views used
across Pi extensions.

## Upstream Pi boundary

Pi already provides `ctx.ui.select(...)`, `ctx.ui.confirm(...)`, and
`ctx.ui.input(...)` for simple dialogs. It also owns custom-component
and overlay lifecycles through `ctx.ui.custom(...)` and
`overlayOptions`, while `@earendil-works/pi-tui` supplies components
such as `SelectList` and `SettingsList`.

Use those upstream APIs directly when their default UI is sufficient.
This package does not re-export or replace them. Its helpers compose
them into the shared my-pi experience: consistent modal chrome,
responsive terminal-height budgets, focus propagation, searchable
settings with metadata, scrollable text, and dense command-output
defaults.

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
  optional search, metadata, and stable-width selection cursor. Use
  up/down to navigate, left/right to choose previous/next values, or
  Enter/Space to advance; left/right continue to edit an active search
  query when it contains text.
- `show_text_modal(ctx, options)` — show scrollable read-only output.
- `show_command_output_modal(ctx, options)` — show dense command or
  status output with shared wide, responsive defaults. Pass
  `max_visible_lines` or `overlay_options` to override that policy for
  a specific report.
- `show_input_modal(ctx, options)` — collect a single text value with
  IME-safe focus propagation.
- `show_confirm_modal(ctx, options)` — confirm/cancel destructive or
  replacing actions.

## Development

<!-- package-readme:development:start commands="check,test,build" -->

Package scripts build transitive workspace dependencies first, then
run local tools through Vite+ with `vp exec`.

```bash
pnpm --filter @spences10/pi-tui-modal run check
pnpm --filter @spences10/pi-tui-modal run test
pnpm --filter @spences10/pi-tui-modal run build
```

<!-- package-readme:development:end -->
