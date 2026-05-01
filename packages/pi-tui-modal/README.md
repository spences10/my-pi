# @spences10/pi-tui-modal

Shared Pi TUI modal helpers for consistent picker, settings, input,
confirmation, and scrollable text overlays.

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
