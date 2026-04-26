# @spences10/pi-sqlite-tools

Pi extension that reminds the model to prefer `mcp-sqlite-tools` for
SQLite database work instead of raw `sqlite3` shell commands.

This package does **not** start the MCP server and does **not**
duplicate its tools. `mcp-sqlite-tools` remains the source of truth;
this extension only injects workflow guidance when SQLite MCP tools
are available.

## Installation

```bash
pi install npm:@spences10/pi-sqlite-tools
```

Local development from this monorepo:

```bash
pnpm --filter @spences10/pi-sqlite-tools run build
pi install ./packages/pi-sqlite-tools
# or for one run only
pi -e ./packages/pi-sqlite-tools
```

## What it does

The extension injects a system reminder telling the model to use
`mcp-sqlite-tools` when working with SQLite files such as:

- `.db`
- `.sqlite`
- `.sqlite3`

It encourages the safer MCP workflow:

- open databases with `open_database`
- inspect structure with `database_info`, `list_tables`,
  `describe_table`, and `export_schema`
- run reads with `execute_read_query`
- back up and use transactions before writes or schema changes
- close databases when finished

It adds no slash commands and no custom tools.

## Example MCP config

`mcp-sqlite-tools` must be configured separately, for example in
`~/.pi/agent/mcp.json`:

```json
{
	"mcpServers": {
		"mcp-sqlite-tools": {
			"command": "npx",
			"args": ["-y", "mcp-sqlite-tools"]
		}
	}
}
```

## Using from a custom harness

```ts
import sqliteTools from '@spences10/pi-sqlite-tools';

// pass `sqliteTools` as an ExtensionFactory to your Pi runtime
```

`my-pi` imports this package directly and enables it as the built-in
SQLite tools reminder.

## Development

```bash
pnpm --filter @spences10/pi-sqlite-tools run check
pnpm --filter @spences10/pi-sqlite-tools run test
pnpm --filter @spences10/pi-sqlite-tools run build
```

## License

MIT
