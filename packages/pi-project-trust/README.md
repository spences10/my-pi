# @spences10/pi-project-trust

Shared project-resource trust policy helpers for Pi extensions.

Use this package when an extension needs to decide whether to load
repo-controlled resources that can execute code or influence model
context, such as project MCP config, hook config, or project-local LSP
binaries.

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

Trust stores are small JSON files written with mode `0600`. Hash-based
subjects are invalidated when their hash changes. Path-only subjects
are supported for current LSP binary trust semantics.

## Development

```bash
pnpm --filter @spences10/pi-project-trust run check
pnpm --filter @spences10/pi-project-trust run test
pnpm --filter @spences10/pi-project-trust run build
```

## License

MIT
