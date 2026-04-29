# @spences10/pi-child-env

Shared safe environment builder for Pi child processes.

By default it passes only a minimal non-secret baseline (`PATH`,
locale, terminal, temp, home/user, color, and `LC_*` vars). Secrets
and provider credentials are not inherited unless explicitly
allowlisted.

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
