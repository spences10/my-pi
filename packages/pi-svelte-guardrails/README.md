# @spences10/pi-svelte-guardrails

[![built with Vite+](https://img.shields.io/badge/built%20with-Vite+-646CFF?logo=vite&logoColor=white)](https://viteplus.dev)
[![tested with Vitest](https://img.shields.io/badge/tested%20with-Vitest-6E9F18?logo=vitest&logoColor=white)](https://vitest.dev)
[![npm version](https://img.shields.io/npm/v/@spences10/pi-svelte-guardrails?color=CB3837&logo=npm&logoColor=white)](https://www.npmjs.com/package/@spences10/pi-svelte-guardrails)
[![license](https://img.shields.io/npm/l/@spences10/pi-svelte-guardrails)](https://www.npmjs.com/package/@spences10/pi-svelte-guardrails)

![my-pi package preview](https://raw.githubusercontent.com/spences10/my-pi/main/assets/pi-package-preview.png)

Catch discouraged Svelte patterns before they land in your codebase.
`pi-svelte-guardrails` blocks common agent mistakes and points the
model toward current Svelte 5 practices while edits are still cheap to
fix.

By default, blocks `$effect` in `.svelte` `write`/`edit` tool calls
and bash writes, then tells the agent to prefer `$derived`, event
handlers, actions, or explicit lifecycle alternatives.

```bash
pi install npm:@spences10/pi-svelte-guardrails
```

Standalone package use is opt-in: installing the package globally
applies it to your Pi sessions, but projects and downstream users do
not inherit it unless they install the package.

## Status and disabling

Use `/extensions` or `/extensions list` in `my-pi` to inspect whether
Svelte guardrails are enabled, disabled by saved settings, or
force-disabled for the current process.

Disable options:

- CLI: start `my-pi` with `--no-svelte-guardrails`.
- TUI: toggle `Svelte guardrails` in `/extensions` and reload.
- SDK/API: pass `svelte_guardrails: false` to `create_my_pi()`.
- Rule config: set `"mode": "off"` or `"blockEffect": false` in the
  config file below.

## Configuration

Create `~/.config/my-pi/svelte-guardrails.json` to tune the guardrail
globally, or `.pi/svelte-guardrails.json` in a project to override it
locally:

```json
{
	"blockEffect": true,
	"allow": ["examples/**", "legacy/**"],
	"mode": "block"
}
```

- `blockEffect`: set to `false` to disable the `$effect` rule while
  keeping the extension installed.
- `allow`: glob patterns for paths where the rule is skipped.
- `mode`: `block` prevents the write, `warn` allows it with a warning,
  and `off` skips the rule.

Current default:

```json
{
	"version": 1,
	"blockEffect": true,
	"allow": [],
	"mode": "block"
}
```

Use `block` for strict enforcement, `warn` to observe violations
before enforcing them, and `off` for projects that intentionally allow
the pattern. The current default remains `block`.

When a tool result says a write was blocked, the target file was not
created or modified. Rewrite the change without `$effect` and run the
write/edit again before reporting success.

## Development

Package scripts build transitive workspace dependencies first, then
run local tools through Vite+ with `vp exec`.

```bash
pnpm --filter @spences10/pi-svelte-guardrails run check
pnpm --filter @spences10/pi-svelte-guardrails run test
pnpm --filter @spences10/pi-svelte-guardrails run build
```
