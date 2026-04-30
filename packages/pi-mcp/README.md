# @spences10/pi-mcp

[![npm version](https://img.shields.io/npm/v/@spences10/pi-mcp?color=CB3837&logo=npm)](https://www.npmjs.com/package/@spences10/pi-mcp)
[![built with Vite+](https://img.shields.io/badge/built%20with-Vite+-646CFF?logo=vite&logoColor=white)](https://viteplus.dev)
[![tested with Vitest](https://img.shields.io/badge/tested%20with-Vitest-6E9F18?logo=vitest&logoColor=white)](https://vitest.dev)

Pi extension for connecting MCP servers and exposing their tools
inside Pi.

Maintained in the `my-pi` Vite+ workspace and tested with Vitest.

## Installation

```bash
pi install npm:@spences10/pi-mcp
```

Local development from this monorepo:

```bash
pnpm --filter @spences10/pi-mcp run build
pi install ./packages/pi-mcp
# or for one run only
pi -e ./packages/pi-mcp
```

## Configuration

The extension loads MCP server definitions from `mcp.json` files in
global and project locations.

A typical project `mcp.json` looks like:

```json
{
	"mcpServers": {
		"sqlite": {
			"command": "npx",
			"args": ["-y", "mcp-sqlite-tools", "./data.db"]
		}
	}
}
```

Global MCP config is loaded automatically. Project-local `mcp.json` is
untrusted by default because stdio servers can spawn local commands.
Interactive runs prompt before loading it; headless runs skip it
unless `MY_PI_MCP_PROJECT_CONFIG=allow` is set. Allow-once mode loads
project MCP tools but suppresses rich tool descriptions and schema
prose so untrusted server metadata cannot act as prompt injection. Use
`MY_PI_MCP_PROJECT_CONFIG=trust` to trust and remember the current
repo until its `mcp.json` hash changes and expose full metadata, or
`MY_PI_MCP_PROJECT_CONFIG=skip` to force-disable project MCP config.

Stdio MCP servers receive a restricted child-process environment by
default: baseline shell variables plus explicit per-server `env`
values. Use `MY_PI_MCP_ENV_ALLOWLIST=NAME,OTHER_NAME` or the shared
`MY_PI_CHILD_ENV_ALLOWLIST` to pass selected ambient variables
through.

Server tools are registered as Pi tools using this naming format:

```text
mcp__<server>__<tool>
```

For example, a `sqlite` server tool named `execute_read_query`
becomes:

```text
mcp__sqlite__execute_read_query
```

## Commands

```text
/mcp                         # open the TUI server manager
/mcp manage                  # same as /mcp
/mcp list
/mcp enable <server>
/mcp disable <server>
/mcp backup                  # backup global + project MCP config
/mcp restore [backup-file]   # restore from picker or filename/path
/mcp profile list
/mcp profile save [name]
/mcp profile load [name] [global|project]
/mcp profiles                # picker for profile load
```

Use `/mcp` to open a searchable modal for enabling/disabling servers.
Toggles update the current session and persist a `disabled`/`enabled`
flag in the winning `mcp.json` entry. Backups are written under
`~/.pi/agent/mcp-backups/` and restore global/project MCP config
exactly as captured. Profiles are saved under
`~/.pi/agent/mcp-profiles/` as reusable merged server sets that can be
loaded into global or project MCP config.

## What it does

- reads MCP server config
- connects to stdio or HTTP MCP servers
- performs the MCP `initialize` handshake
- discovers tools via `tools/list`
- registers each discovered MCP tool with Pi
- forwards model tool calls to the MCP server
- truncates oversized MCP tool text output to the first 50 KiB or
  2,000 lines
- saves truncated full output to a local `/tmp/my-pi-mcp-output-*.txt`
  file so it can be inspected with `read` or `rg`
- cleans up server processes on session shutdown

## Using from a custom harness

```ts
import mcp from '@spences10/pi-mcp';

// pass `mcp` as an ExtensionFactory to your Pi runtime
```

`my-pi` imports this package directly and enables it as the built-in
MCP extension.

## Development

```bash
pnpm --filter @spences10/pi-mcp run check
pnpm --filter @spences10/pi-mcp run test
pnpm --filter @spences10/pi-mcp run build
```

## License

MIT
