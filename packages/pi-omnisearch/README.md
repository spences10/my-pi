# @spences10/pi-omnisearch

[![npm version](https://img.shields.io/npm/v/@spences10/pi-omnisearch?color=CB3837&logo=npm)](https://www.npmjs.com/package/@spences10/pi-omnisearch)
[![built with Vite+](https://img.shields.io/badge/built%20with-Vite+-646CFF?logo=vite&logoColor=white)](https://viteplus.dev)
[![tested with Vitest](https://img.shields.io/badge/tested%20with-Vitest-6E9F18?logo=vitest&logoColor=white)](https://vitest.dev)

Pi extension that reminds the model to use `mcp-omnisearch` for
verified web research instead of relying on stale model memory or
search snippets. It does not start or duplicate the MCP server; it
only injects workflow guidance when Omnisearch tools are available.

Maintained in the `my-pi` Vite+ workspace and tested with Vitest.

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
