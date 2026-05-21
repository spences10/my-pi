# @spences10/pi-footer

[![built with Vite+](https://img.shields.io/badge/built%20with-Vite+-646CFF?logo=vite&logoColor=white)](https://viteplus.dev)
[![tested with Vitest](https://img.shields.io/badge/tested%20with-Vitest-6E9F18?logo=vitest&logoColor=white)](https://vitest.dev)
[![npm version](https://img.shields.io/npm/v/@spences10/pi-footer?color=CB3837&logo=npm&logoColor=white)](https://www.npmjs.com/package/@spences10/pi-footer)
[![license](https://img.shields.io/npm/l/@spences10/pi-footer)](https://www.npmjs.com/package/@spences10/pi-footer)

![my-pi package preview](https://raw.githubusercontent.com/spences10/my-pi/main/assets/pi-package-preview.png)

See the session state that matters without leaving Pi. `pi-footer`
adds a configurable statusline for model, project, Git, token, and
runtime signals so long agent sessions stay easy to orient and trust.

It owns `ctx.ui.setFooter(...)` and renders core Pi session data plus
extension statuses published by other extensions with
`ctx.ui.setStatus(...)`.

## Commands

- `/footer` — pick a footer preset with a modal.

## Presets

- `default` — current my-pi-style 2–3 line footer.
- `minimal` — compact cwd/model/context footer.
- `power` — fuller status-forward layout.
- `git-heavy` — emphasizes cwd/git/status widgets.

## Development

Package scripts build transitive workspace dependencies first, then
run local tools through Vite+ with `vp exec`.

```bash
pnpm --filter @spences10/pi-footer run check
pnpm --filter @spences10/pi-footer run test
pnpm --filter @spences10/pi-footer run build
```
