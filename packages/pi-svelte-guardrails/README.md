# @spences10/pi-svelte-guardrails

<!-- package-readme:header:start -->

[![built with Vite+](https://img.shields.io/badge/built%20with-Vite+-646CFF?logo=vite&logoColor=white)](https://viteplus.dev)
[![tested with Vitest](https://img.shields.io/badge/tested%20with-Vitest-6E9F18?logo=vitest&logoColor=white)](https://vitest.dev)
[![npm version](https://img.shields.io/npm/v/@spences10/pi-svelte-guardrails?color=CB3837&logo=npm&logoColor=white)](https://www.npmjs.com/package/@spences10/pi-svelte-guardrails)
[![license](https://img.shields.io/npm/l/@spences10/pi-svelte-guardrails)](https://www.npmjs.com/package/@spences10/pi-svelte-guardrails)

![my-pi package preview](https://raw.githubusercontent.com/spences10/my-pi/main/assets/pi-package-preview.png)

<!-- package-readme:header:end -->

Enforce a local policy against agent-written `$effect` by default.
`pi-svelte-guardrails` blocks matching Svelte `write`/`edit` tool
calls and recognized bash writes before execution.

The [official Svelte guidance](https://svelte.dev/docs/ai/skills) says
that effects are an escape hatch and should mostly be avoided. Use:

- `$derived` / `$derived.by` for computed state.
- Event handlers or function bindings for user-triggered changes.
- `onMount` with cleanup for mount-time setup.
- Attachments for element integrations, `$inspect` for debugging, and
  `createSubscriber` for observing external systems.

`onMount` does not rerun when dependencies change, and derived
expressions must be side-effect-free; neither is a blanket effect
replacement. The
[effect reference](https://svelte.dev/docs/svelte/$effect) includes
legitimate imperative uses, but those require an explicit
user-controlled policy exception here. External-library imports do not
grant one automatically.

This extension is a text-pattern policy, not a Svelte parser. Keep
language correctness in the project's compiler, checker, and linter;
passing those checks does not override this policy.

<!-- package-readme:install:start -->

```bash
pi install npm:@spences10/pi-svelte-guardrails
```

<!-- package-readme:install:end -->

Standalone package use is opt-in: installing the package globally
applies it to your Pi sessions, but projects and downstream users do
not inherit it unless they install the package.

## Status and disabling

Disable options:

- Pi: disable the package with `pi config` or `pi remove`.
- Rule config: set `"mode": "off"` or `"blockEffect": false` in the
  config file below.

## Configuration

Set `packages.svelteGuardrails` in `~/.pi/agent/my-pi-settings.json`
to configure the guardrail globally, or use
`.pi/svelte-guardrails.json` for project overrides. This project
example explicitly enables strict blocking:

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

`block` remains the default. Only an explicit user configuration may
allow exceptions through path globs, `warn`, `off`, or `blockEffect`.
Agents should not weaken the policy to get a rejected edit through.
Explicit `warn` mode allows the call with an advisory UI notification;
notifications require a UI and do not add a model-facing lint result
in headless sessions. Run language-aware checks in every mode.

For writes, only proposed content is checked. For edits, only
`newText` or each batched `edits[].newText` is checked, so removing an
existing effect is allowed even in block mode. Recognized bash writes
are checked as command text; this is not complete shell analysis.
Comments and strings containing `$effect(` can still match. If this
blocks necessary content, ask the user for a narrowly scoped exception
or use their language-aware lint policy instead. This is not a
complete security boundary against arbitrary file-writing tools.

Direct calls and native Codemode calls receive the same enforcement.
When a write is blocked, the target file was not created or modified.
Rewrite the proposed change or ask the user to adjust the policy, then
retry before reporting success. Advisory warnings explicitly say the
call is allowed. See the
[validation workflow](https://github.com/spences10/my-pi/tree/main/packages/pi-tool-guidance#language-aware-validation).

## Development

<!-- package-readme:development:start commands="check,test,build" -->

Package scripts build transitive workspace dependencies first, then
run local tools through Vite+ with `vp exec`.

```bash
pnpm --filter @spences10/pi-svelte-guardrails run check
pnpm --filter @spences10/pi-svelte-guardrails run test
pnpm --filter @spences10/pi-svelte-guardrails run build
```

<!-- package-readme:development:end -->
