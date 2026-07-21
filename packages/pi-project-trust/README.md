# @spences10/pi-project-trust

<!-- package-readme:header:start -->

[![built with Vite+](https://img.shields.io/badge/built%20with-Vite+-646CFF?logo=vite&logoColor=white)](https://viteplus.dev)
[![tested with Vitest](https://img.shields.io/badge/tested%20with-Vitest-6E9F18?logo=vitest&logoColor=white)](https://vitest.dev)
[![npm version](https://img.shields.io/npm/v/@spences10/pi-project-trust?color=CB3837&logo=npm&logoColor=white)](https://www.npmjs.com/package/@spences10/pi-project-trust)
[![license](https://img.shields.io/npm/l/@spences10/pi-project-trust)](https://www.npmjs.com/package/@spences10/pi-project-trust)

![my-pi package preview](https://raw.githubusercontent.com/spences10/my-pi/main/assets/pi-package-preview.png)

<!-- package-readme:header:end -->

Share one trust policy across Pi extensions that touch project files
or resources. `pi-project-trust` helps extensions consistently decide
when a path, command, or project-owned resource is safe to use.

Use this package when an extension needs to decide whether to load
repo-controlled resources that can execute code or influence model
context, such as project MCP config, hook config, or project-local LSP
binaries.

## Relationship to upstream Pi

Audit baseline: upstream Pi
[`0.80.10`](https://github.com/earendil-works/pi/tree/8dc78834cde4e329284cf505f9e3f99763df5529/packages/coding-agent)
owns whole-project trust for `.pi/settings.json`, standard `.pi`
resources, and project `.agents/skills`. It exposes that decision to
extensions through `ctx.isProjectTrusted()`. Pi also owns project
package/resource overrides, including `autoload: false`; this package
does not wrap those settings.

`pi-project-trust` remains additive for individual resources Pi does
not discover or hash, including root `mcp.json`, hook commands, and
project-local executables. It supports per-subject hashes, allow-once
decisions, environment policy, and global fallbacks. These records
stay in the global `my-pi-settings.json` store so a project cannot
grant trust to its own resources through `.pi/settings.json`. Callers
whose resources are already fully covered by Pi's project trust should
use `ctx.isProjectTrusted()` instead of adding another prompt.

## Usage

```ts
import { resolve_project_trust } from '@spences10/pi-project-trust';

const decision = await resolve_project_trust(
	{
		kind: 'mcp-config',
		id: '/repo/mcp.json',
		hash: 'sha256',
		store_key: '/repo/mcp.json',
		env_key: 'MY_PI_MCP_PROJECT_CONFIG',
		prompt_title:
			'Project mcp.json can spawn local commands. Trust this config?',
		summary_lines: ['- sqlite: npx mcp-sqlite-tools'],
	},
	{
		has_ui: ctx.hasUI,
		select: ctx.hasUI ? ctx.ui.select : undefined,
	},
);
```

## Reusable trust wrappers

Use `create_project_trust_wrapper()` when several subject-specific
functions need the same store handling. The wrapper constructs the
store path, checks current entries, optionally checks a legacy entry,
and delegates persistence. Kinds, ids, hashes, environment keys,
prompt copy, fallbacks, and choice labels remain in the caller.

```ts
import { create_project_trust_wrapper } from '@spences10/pi-project-trust';

const project_config_trust = create_project_trust_wrapper({
	store_filename: 'trusted-example-projects.json',
	legacy_matcher: (entry, subject) => {
		const legacy = entry as { path?: unknown; hash?: unknown };
		return (
			legacy?.path === subject.id && legacy.hash === subject.hash
		);
	},
});
```

## Decisions

Environment values are normalized consistently across extensions:

- `1`, `true`, `yes`, `allow` — allow once for this run
- `trust` — persist trust for this resource
- `0`, `false`, `no`, `skip`, `disable` — skip the resource
- `global`, `global-only` — use the configured global fallback when a
  subject supports one

Allow-once is intentionally not trust. Callers can use
`decision.metadata_trusted` to keep untrusted model-facing metadata
suppressed while still allowing a resource for the current run.

## Untrusted repo defaults

`apply_project_trust_untrusted_defaults()` sets conservative defaults
for project resources without overriding explicit operator choices:

- `MY_PI_MCP_PROJECT_CONFIG=skip`
- `MY_PI_HOOKS_CONFIG=skip`
- `MY_PI_LSP_PROJECT_BINARY=global`
- `MY_PI_PROMPT_PRESETS_PROJECT=skip`
- `MY_PI_PROJECT_SKILLS=skip`

## Trust stores

Built-in trust store names are persisted under the `trust` section of
global `my-pi-settings.json`; unrecognized custom store names retain
standalone JSON-file behavior for API compatibility. The default store
directory comes from `@spences10/pi-settings`, which already delegates
agent directory normalization to upstream Pi.

Hash-based subjects are invalidated when their hash changes. Path-only
subjects are supported for current LSP binary trust semantics.

## Development

<!-- package-readme:development:start commands="check,test,build" -->

Package scripts build transitive workspace dependencies first, then
run local tools through Vite+ with `vp exec`.

```bash
pnpm --filter @spences10/pi-project-trust run check
pnpm --filter @spences10/pi-project-trust run test
pnpm --filter @spences10/pi-project-trust run build
```

<!-- package-readme:development:end -->

## License

MIT
