# my-pi

Personal [pi](https://pi.dev) coding agent wrapper with MCP tool
integration.

Built on the
[@mariozechner/pi-coding-agent](https://github.com/badlogic/pi-mono)
SDK. Adds MCP server support so models without built-in web search
(like Mistral) can still use external tools.

## Setup

```bash
pnpm install
pnpm run build
```

### API Keys

Pi handles authentication natively via `AuthStorage`. Options
(in priority order):

1. **`pi auth`** — interactive login, stores credentials in
   `~/.pi/agent/auth.json`
2. **Environment variables** — `ANTHROPIC_API_KEY`,
   `MISTRAL_API_KEY`, etc.
3. **OAuth** — supported for providers that offer it

## Usage

### Interactive mode (full TUI)

```bash
node dist/index.js
```

Pi's full terminal UI with editor, `/commands`, model switching
(`Ctrl+L`), session tree (`/tree`), and message queuing.

### Print mode (one-shot)

```bash
node dist/index.js "your prompt here"
node dist/index.js -P "explicit print mode"
```

### Non-TTY

When run without a prompt in a non-TTY environment (e.g. piped or
from an LLM agent), shows usage help instead of launching the TUI.

## MCP Servers

MCP servers are configured via `mcp.json` files. my-pi spawns each
server as a child process over stdio and bridges their tools into
pi's `customTools`.

### Global config

`~/.pi/agent/mcp.json` — available to all projects:

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

### Project config

`./mcp.json` in the project root — overrides global servers by
name:

```json
{
  "mcpServers": {
    "my-search": {
      "command": "npx",
      "args": ["-y", "some-mcp-server"],
      "env": {
        "API_KEY": "..."
      }
    }
  }
}
```

Project servers merge with global servers. If both define the same
server name, the project config wins.

### How it works

1. Spawns each MCP server as a child process (stdio transport)
2. Performs the MCP `initialize` handshake
3. Calls `tools/list` to discover available tools
4. Wraps each tool via pi's `defineTool()` as a `customTool`
5. Tools are available to the model as `mcp__<server>__<tool>`

## Project Structure

```
src/
  index.ts          CLI entry point (citty + pi SDK)
  mcp/
    client.ts       Minimal MCP stdio client (JSON-RPC 2.0)
    bridge.ts       Converts MCP tools to pi customTools
    config.ts       Loads and merges mcp.json configs
mcp.json            Project MCP server config
```

## Development

```bash
pnpm run dev        # Watch mode
pnpm run check      # Lint + type check
pnpm run test       # Run tests
pnpm run build      # Production build
```

## License

MIT
