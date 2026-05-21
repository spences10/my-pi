# @spences10/pi-themes

[![built with Vite+](https://img.shields.io/badge/built%20with-Vite+-646CFF?logo=vite&logoColor=white)](https://viteplus.dev)
[![npm version](https://img.shields.io/npm/v/@spences10/pi-themes?color=CB3837&logo=npm&logoColor=white)](https://www.npmjs.com/package/@spences10/pi-themes)
[![license](https://img.shields.io/npm/l/@spences10/pi-themes)](https://www.npmjs.com/package/@spences10/pi-themes)

![my-pi package preview](https://raw.githubusercontent.com/spences10/my-pi/main/assets/pi-package-preview.png)

Make Pi feel like your workspace instead of a default terminal app.
`pi-themes` bundles polished color themes for the Pi coding agent,
giving sessions clearer contrast, mood, and visual hierarchy.

## Install

```bash
pi install npm:@spences10/pi-themes
```

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

## Development

This package is included in the Vite+ workspace, but its package-level
build and test scripts are currently no-ops because it ships static
theme assets.

```bash
pnpm --filter @spences10/pi-themes run check
pnpm --filter @spences10/pi-themes run build
```
