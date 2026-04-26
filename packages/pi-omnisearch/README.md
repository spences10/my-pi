# @spences10/pi-omnisearch

Pi extension that reminds the model to use `mcp-omnisearch` for
verified web research instead of relying on stale model memory or
search snippets.

This package does **not** start the MCP server and does **not**
duplicate its tools. `mcp-omnisearch` remains the source of truth;
this extension only injects workflow guidance when Omnisearch MCP
tools are available.

## Installation

```bash
pi install npm:@spences10/pi-omnisearch
```

Local development from this monorepo:

```bash
pnpm --filter @spences10/pi-omnisearch run build
pi install ./packages/pi-omnisearch
# or for one run only
pi -e ./packages/pi-omnisearch
```

## What it does

The extension injects a system reminder telling the model to use
`mcp-omnisearch` when the user asks to:

- research current information
- verify facts or citations
- inspect documentation
- compare packages, APIs, or tools
- extract and summarize web content

It encourages the verified research workflow from Scott's ecosystem
skill:

- use `web_search` for discovery
- use `web_extract` to read actual source content before making claims
- use `ai_search` for synthesized answers with sources
- prefer official docs, repositories, release notes, and source files
- report partial failures, conflicts, and uncertainty

It adds no slash commands and no custom tools.

## Example MCP config

`mcp-omnisearch` must be configured separately, for example in
`~/.pi/agent/mcp.json`:

```json
{
	"mcpServers": {
		"mcp-omnisearch": {
			"command": "npx",
			"args": ["-y", "mcp-omnisearch"]
		}
	}
}
```

## Using from a custom harness

```ts
import omnisearch from '@spences10/pi-omnisearch';

// pass `omnisearch` as an ExtensionFactory to your Pi runtime
```

`my-pi` imports this package directly and enables it as the built-in
Omnisearch reminder.

## Development

```bash
pnpm --filter @spences10/pi-omnisearch run check
pnpm --filter @spences10/pi-omnisearch run test
pnpm --filter @spences10/pi-omnisearch run build
```

## License

MIT
