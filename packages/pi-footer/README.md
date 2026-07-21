# @spences10/pi-footer

<!-- package-readme:header:start -->

[![built with Vite+](https://img.shields.io/badge/built%20with-Vite+-646CFF?logo=vite&logoColor=white)](https://viteplus.dev)
[![tested with Vitest](https://img.shields.io/badge/tested%20with-Vitest-6E9F18?logo=vitest&logoColor=white)](https://vitest.dev)
[![npm version](https://img.shields.io/npm/v/@spences10/pi-footer?color=CB3837&logo=npm&logoColor=white)](https://www.npmjs.com/package/@spences10/pi-footer)
[![license](https://img.shields.io/npm/l/@spences10/pi-footer)](https://www.npmjs.com/package/@spences10/pi-footer)

![my-pi package preview](https://raw.githubusercontent.com/spences10/my-pi/main/assets/pi-package-preview.png)

<!-- package-readme:header:end -->

See the session state that matters without leaving Pi. `pi-footer`
adds a configurable statusline for model, project, Git, token, and
runtime signals so long agent sessions stay easy to orient and trust.

## Upstream Pi boundary

Pi owns the footer lifecycle through `ctx.ui.setFooter(...)` and
status transport through `ctx.ui.setStatus(...)` plus the footer data
provider. This package directly calls `setFooter` and reads the data
provider; it does not call, wrap, or re-export `setStatus`. Other
extensions publish status values through `setStatus`, and Pi supplies
them to this renderer through the provider. Without the curated
layouts below, Pi's built-in footer already renders core session data
and extension statuses.

`pi-footer` adds the configurable part: presets, density and tone,
selectable widgets, multi-row status placement, persistent settings,
and the `/footer` live-preview workflow. Installing it replaces Pi's
built-in footer renderer with that curated UI while continuing to read
status values published through Pi's native API. Session names are
read from Pi on every render; Pi invalidates the footer when
`session_info_changed` fires, so this package does not poll session
metadata.

## Library API

`@spences10/pi-footer` is both a Pi extension and a supported library.
The package root is the only public import path; files under `dist/`
are implementation details.

```ts
import footer_extension, {
	FOOTER_PRESETS,
	get_current_thinking_level,
	render_footer_status_line,
} from '@spences10/pi-footer';
```

The root API includes:

- the default Pi extension;
- `get_current_thinking_level` and `get_default_footer_thinking_level`
  for model-thinking status;
- `render_footer_lines`, `render_footer_status_line`, and
  `render_footer_three_column_line` for footer rendering;
- `FOOTER_PRESETS`, `FOOTER_DENSITIES`, `FOOTER_STATUS_ALIGNMENTS`,
  `FOOTER_TONES`, `FOOTER_WIDGETS`, plus `FooterPreset`,
  `FooterDensity`, `FooterStatusAlignment`, `FooterStatusLayout`,
  `FooterStatusPlacement`, `FooterTone`, and `FooterWidget` for
  configuration-aware integrations;
- `FOOTER_COLORS` and `FooterTheme` for theme-compatible rendering;
- `FOOTER_RESEARCH_REFERENCES`, the reference metadata shown by the
  `/footer` preset guidance.

These root exports are compatibility-supported. Additive changes can
ship in minor or patch releases, while removing or changing an export
requires a breaking release.

## Commands

- `/footer` — configure layout, density, appearance, visible content,
  and extension-status placement with a live preview.

Extension statuses published through `ctx.ui.setStatus(...)` can be
assigned independently to any numbered row, aligned left, center, or
right, or hidden. Populated rows render in order; empty rows collapse
automatically. Compact density renders the first populated status row.

The default layout keeps harness and prompt state on row 1, then
places MCP/service health on row 2 left and Codex usage on row 2
right. Footer choices persist under the `packages.footer` section in
`~/.pi/agent/my-pi-settings.json`.

## Presets

- `default` — current my-pi-style 2–3 line footer.
- `minimal` — compact cwd/model/context footer.
- `power` — fuller status-forward layout.
- `git-heavy` — emphasizes cwd/git/status widgets.

## Development

<!-- package-readme:development:start commands="check,test,build" -->

Package scripts build transitive workspace dependencies first, then
run local tools through Vite+ with `vp exec`.

```bash
pnpm --filter @spences10/pi-footer run check
pnpm --filter @spences10/pi-footer run test
pnpm --filter @spences10/pi-footer run build
```

<!-- package-readme:development:end -->
