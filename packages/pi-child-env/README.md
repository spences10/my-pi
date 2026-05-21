# @spences10/pi-child-env

[![built with Vite+](https://img.shields.io/badge/built%20with-Vite+-646CFF?logo=vite&logoColor=white)](https://viteplus.dev)
[![tested with Vitest](https://img.shields.io/badge/tested%20with-Vitest-6E9F18?logo=vitest&logoColor=white)](https://vitest.dev)
[![npm version](https://img.shields.io/npm/v/@spences10/pi-child-env?color=CB3837&logo=npm&logoColor=white)](https://www.npmjs.com/package/@spences10/pi-child-env)
[![license](https://img.shields.io/npm/l/@spences10/pi-child-env)](https://www.npmjs.com/package/@spences10/pi-child-env)

![my-pi package preview](https://raw.githubusercontent.com/spences10/my-pi/main/assets/pi-package-preview.png)

Launch Pi child processes without leaking unsafe environment state.
`pi-child-env` centralizes the allowlist/scrubbing rules extensions
use for subprocesses, so tools get the variables they need while
secrets and noisy runtime internals stay out.

By default it passes only a minimal non-secret baseline (`PATH`,
`PI_CODING_AGENT_DIR`, locale, terminal, temp, home/user, color, and
`LC_*` vars). Secrets and provider credentials are not inherited
unless explicitly allowlisted.

## Usage

```ts
import { create_child_process_env } from '@spences10/pi-child-env';

spawn(command, args, {
	env: create_child_process_env({
		profile: 'team-mode',
		explicit_env: {
			MY_PI_TEAM_MEMBER: 'alice',
		},
	}),
});
```

## Allowlists

All profiles honor `MY_PI_CHILD_ENV_ALLOWLIST=NAME,OTHER_NAME`.

Profile-specific allowlists:

- `mcp` — `MY_PI_MCP_ENV_ALLOWLIST`
- `lsp` — `MY_PI_LSP_ENV_ALLOWLIST`
- `hooks` — `MY_PI_HOOKS_ENV_ALLOWLIST`
- `team-mode` — `MY_PI_TEAM_MODE_ENV_ALLOWLIST`

Use allowlists only for variables the child process truly needs.

## Development

Package scripts build transitive workspace dependencies first, then
run local tools through Vite+ with `vp exec`.

```bash
pnpm --filter @spences10/pi-child-env run check
pnpm --filter @spences10/pi-child-env run test
pnpm --filter @spences10/pi-child-env run build
```
