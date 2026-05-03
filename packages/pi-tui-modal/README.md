# @spences10/pi-tui-modal

Shared Pi TUI modal helpers for consistent picker, settings, input,
confirmation, and scrollable text overlays.

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
