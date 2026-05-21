# @spences10/pi-omnisearch

[![built with Vite+](https://img.shields.io/badge/built%20with-Vite+-646CFF?logo=vite&logoColor=white)](https://viteplus.dev)
[![tested with Vitest](https://img.shields.io/badge/tested%20with-Vitest-6E9F18?logo=vitest&logoColor=white)](https://vitest.dev)
[![npm version](https://img.shields.io/npm/v/@spences10/pi-omnisearch?color=CB3837&logo=npm&logoColor=white)](https://www.npmjs.com/package/@spences10/pi-omnisearch)
[![license](https://img.shields.io/npm/l/@spences10/pi-omnisearch)](https://www.npmjs.com/package/@spences10/pi-omnisearch)

![my-pi package preview](https://raw.githubusercontent.com/spences10/my-pi/main/assets/pi-package-preview.png)

Make agents verify current facts before answering. `pi-omnisearch`
reminds the model to use the Omnisearch MCP tools for web search,
extraction, and cited synthesis instead of relying on stale memory or
snippets.

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

It encourages the verified research workflow from the ecosystem guide
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

Package scripts build transitive workspace dependencies first, then
run local tools through Vite+ with `vp exec`.

```bash
pnpm --filter @spences10/pi-omnisearch run check
pnpm --filter @spences10/pi-omnisearch run test
pnpm --filter @spences10/pi-omnisearch run build
```

## License

MIT
