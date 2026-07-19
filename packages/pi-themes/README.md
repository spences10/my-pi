# @spences10/pi-themes

<!-- package-readme:header:start vitest="false" -->

[![built with Vite+](https://img.shields.io/badge/built%20with-Vite+-646CFF?logo=vite&logoColor=white)](https://viteplus.dev)
[![npm version](https://img.shields.io/npm/v/@spences10/pi-themes?color=CB3837&logo=npm&logoColor=white)](https://www.npmjs.com/package/@spences10/pi-themes)
[![license](https://img.shields.io/npm/l/@spences10/pi-themes)](https://www.npmjs.com/package/@spences10/pi-themes)

![my-pi package preview](https://raw.githubusercontent.com/spences10/my-pi/main/assets/pi-package-preview.png)

<!-- package-readme:header:end -->

Make Pi feel like your workspace instead of a default terminal app.
`pi-themes` bundles polished color themes for the Pi coding agent,
giving sessions clearer contrast, mood, and visual hierarchy.

## Install

<!-- package-readme:install:start -->

```bash
pi install npm:@spences10/pi-themes
```

<!-- package-readme:install:end -->

Then choose a theme in `/settings`, or persist one in Pi settings
JSON:

```json
{
	"theme": "tokyo-night"
}
```

## Included themes

- Catppuccin Mocha
- Dracula
- Gruvbox Dark
- Night Owl
- Neon Afterglow
- Neon Noir
- Nord
- One Dark
- Rosé Pine
- Solarized Dark
- Tokyo Night

## Bring your own themes

Keep personal, team, or brand-specific themes outside this default
pack. Pi loads custom themes from `~/.pi/agent/themes/*.json`,
project-local `.pi/themes/*.json`, `--theme <path>`, or any installed
package with a `pi.themes` manifest entry.

A minimal standalone theme package looks like this:

```json
{
	"name": "@your-scope/pi-your-themes",
	"files": ["themes", "README.md"],
	"pi": {
		"themes": ["./themes"]
	}
}
```

Put theme JSON files in `themes/`, publish the package, then install
it:

```bash
pi install npm:@your-scope/pi-your-themes
```

## Development

This package is included in the Vite+ workspace, but its package-level
build and test scripts are currently no-ops because it ships static
theme assets.

```bash
pnpm --filter @spences10/pi-themes run check
pnpm --filter @spences10/pi-themes run build
```
