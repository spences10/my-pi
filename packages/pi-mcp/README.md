# @spences10/pi-mcp

[![built with vite+](https://img.shields.io/badge/built%20with-Vite+-646CFF?logo=vite&logoColor=white)](https://viteplus.dev)
[![tested with vitest](https://img.shields.io/badge/tested%20with-Vitest-6E9F18?logo=vitest&logoColor=white)](https://vitest.dev)

Pi extension for connecting MCP servers and exposing their tools
inside Pi.

## Install

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
/mcp list
/mcp enable <server>
/mcp disable <server>
```

Use `/mcp list` to inspect connection state and `/mcp enable` or
`/mcp disable` to toggle a server's registered tools during a session.

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
