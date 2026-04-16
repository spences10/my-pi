# my-pi

Composable [pi](https://pi.dev) coding agent for humans and agents.

Built on the
[@mariozechner/pi-coding-agent](https://github.com/badlogic/pi-mono)
SDK. Adds MCP server support, extension stacking, JSON output for
agent consumption, and a programmatic API.

Extension stacking patterns inspired by
[pi-vs-claude-code](https://github.com/disler/pi-vs-claude-code).

## Setup

```bash
pnpm install
pnpm run build
```

### API Keys

Pi handles authentication natively via `AuthStorage`. Options (in
priority order):

1. **`pi auth`** — interactive login, stores credentials in
   `~/.pi/agent/auth.json`
2. **Environment variables** — `ANTHROPIC_API_KEY`, `MISTRAL_API_KEY`,
   etc.
3. **OAuth** — supported for providers that offer it

## Usage

### Interactive mode (full TUI)

```bash
my-pi
```

Pi's full terminal UI with editor, `/commands`, model switching
(`Ctrl+L`), session tree (`/tree`), and message queuing.

### Print mode (one-shot)

```bash
my-pi "your prompt here"
my-pi -P "explicit print mode"
```

### JSON output (for agents)

```bash
my-pi --json "list all TODO comments"
echo "plan a login page" | my-pi --json
```

Outputs NDJSON events — one JSON object per line — for programmatic
consumption by other agents or scripts.

### Extension stacking

```bash
my-pi -e ./ext/damage-control.ts -e ./ext/tool-counter.ts
my-pi --no-builtin -e ./ext/custom.ts "do something"
```

Stack arbitrary Pi extensions via `-e`. Use `--no-builtin` to skip all
built-in extensions.

Built-in extension choices can also be saved interactively with
`/extensions`. Startup flags like `--no-recall` and `--no-skills`
still force-disable those extensions for the current process only.

### Themes

`my-pi` ships a bundled theme pack from `./themes` and loads it into
the runtime automatically. Pick a theme in `/settings`, or persist one
via Pi settings JSON:

```json
{
	"theme": "tokyo-night"
}
```

### Stdin piping

```bash
echo "review this code" | my-pi
cat plan.md | my-pi --json
```

When stdin is piped, it's read as the prompt and print mode runs
automatically.

### Programmatic API

```ts
import { createMyPi, runPrintMode } from 'my-pi';

const runtime = await createMyPi({
	extensions: ['./my-ext.ts'],
	builtins: true,
});
await runPrintMode(runtime, {
	mode: 'json',
	initialMessage: 'hello',
	initialImages: [],
	messages: [],
});
```

## MCP Servers

MCP servers are configured via `mcp.json` files and managed as a pi
extension. Stdio servers are spawned on startup, HTTP servers are
connected remotely, and their tools are registered via
`pi.registerTool()`.

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

`./mcp.json` in the project root — overrides global servers by name:

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

HTTP MCP servers are supported too:

```json
{
	"mcpServers": {
		"pm-platform": {
			"type": "http",
			"url": "https://project.cloudlobsters.com/api/mcp",
			"headers": {
				"Authorization": "Bearer ..."
			}
		}
	}
}
```

Use `"type": "http"` or `"type": "streamable-http"` for remote MCP
servers. If `url` is present, my-pi treats the entry as HTTP.

Project servers merge with global servers. If both define the same
server name, the project config wins.

### Commands

In interactive mode:

- `/mcp list` — show connected servers and tool counts
- `/mcp enable <server>` — enable a disabled server's tools
- `/mcp disable <server>` — disable a server's tools
- `/extensions` — open the built-in extensions manager
- `/extensions list` — print built-in extensions with saved/effective
  state
- `/extensions enable <key>` / `/extensions disable <key>` — toggle a
  built-in extension
- `/skills` — open the interactive skills manager (unified list with
  managed and importable sections, checkbox batch-import)
- `/skills import <key|name>` — import an external skill from the
  command line
- `/skills sync <key|name>` — sync an imported skill to its upstream
- `/skills refresh` — rescan skill directories
- `/skills defaults <all-enabled|all-disabled>` — set default policy
- `/preset` — open the prompt preset manager (base presets + layers)
- `/preset <name>` — activate a base preset or toggle a layer
- `/preset base <name>` — activate a base preset directly
- `/preset enable <layer>` / `/preset disable <layer>` — toggle a
  prompt layer directly
- `/preset edit <name>` — edit or create a project-local preset in
  `.pi/presets.json`
- `/preset delete <name>` — delete a project-local preset
- `/preset reset <name>` — remove a project-local override and fall
  back to user/built-in if available
- `/preset clear` — clear the active base preset and all layers

### How it works

1. Pi extension loads `mcp.json` configs (global + project)
2. Connects to each MCP server using stdio or HTTP transport
3. Performs the MCP `initialize` handshake
4. Calls `tools/list` to discover available tools
5. Registers each tool via `pi.registerTool()` as
   `mcp__<server>__<tool>`
6. `/mcp enable/disable` toggles tools via `pi.setActiveTools()`
7. Built-in extension state can be managed via `/extensions` and is
   persisted in `~/.config/my-pi/extensions.json`
8. Cleanup on `session_shutdown`

## Agent Chains

Define sequential agent pipelines in `.pi/agents/agent-chain.yaml`:

```yaml
scout-plan:
  description: 'Scout the codebase then plan implementation'
  steps:
    - agent: scout
      prompt: 'Explore and analyze: $INPUT'
    - agent: planner
      prompt: 'Based on this analysis, create a plan:\n\n$INPUT'
```

Agent definitions live in `.pi/agents/*.md` with frontmatter:

```markdown
---
name: scout
description: Codebase exploration and analysis
tools: read,grep,find,ls
---

You are a scout agent. Explore the codebase and report findings.
```

The chain extension injects context into the system prompt so the LLM
knows when and how to use `run_chain`. Use `/chain` to switch active
chains and `/agents` to list available agents.

## Secret Redaction

The filter-output extension automatically redacts secrets (API keys,
tokens, passwords, private keys) from tool output before the LLM sees
them. Detection patterns from
[nopeek](https://github.com/spences10/nopeek).

Use `/redact-stats` to see how many secrets were caught. Disable with
`--no-filter`.

## Prompt Presets

Prompt presets append runtime instructions to the system prompt
through a built-in extension. They are split into:

- **base presets** — one active at a time
- **prompt layers** — additive checkboxes you can combine

Built-in base presets:

- `terse` — short, direct, no fluff
- `standard` — clear and concise with key context
- `detailed` — more explanation when nuance matters

Built-in layers:

- `no-purple-prose`
- `bullets`
- `clarify-first`
- `include-risks`

Preset sources are merged in this order:

1. built-in defaults
2. `~/.pi/agent/presets.json`
3. `.pi/presets.json`

Project presets override global/default presets with the same name.
Strings are treated as base presets by default. Object entries may set
`kind: "base"` or `kind: "layer"`.

CLI layering is supported too:

- `--preset terse,no-purple-prose,bullets`
- `--system-prompt "You are terse and technical."`
- `--append-system-prompt "Prefer one short paragraph."`

Interactive `/preset` selections are also restored on later sessions
for the same project via `~/.pi/agent/prompt-preset-state.json`.

This repo also includes an example `.pi/presets.json` with sample base
presets and layers.

## Session Handoff

Use `/handoff <task>` to export conversation context as a markdown
file that can be piped into a new session:

```bash
# In session 1: /handoff continue the auth refactor
# Then:
my-pi < handoff-1234567890.md
```

## Project Structure

```
src/
  index.ts            CLI entry point (citty + pi SDK)
  api.ts              Programmatic API (create_my_pi + re-exports)
  extensions/
    config.ts         Persistent built-in extension config
    extensions.ts     Built-in extension manager (/extensions)
    mcp.ts            MCP server integration
    skills.ts         Skill discovery and toggle
    chain.ts          Agent chain pipelines
    filter-output.ts  Secret redaction in tool output
    handoff.ts        Session context export
    prompt-presets.ts Runtime prompt preset selection and editing
    recall.ts         Past session recall guidance
  mcp/
    client.ts         Minimal MCP stdio client (JSON-RPC 2.0)
    config.ts         Loads and merges mcp.json configs
  skills/
    manager.ts        Skill enable/disable state management
    scanner.ts        Skill discovery across sources
    config.ts         Persistent skills config (~/.config/my-pi/)
.pi/
  agents/
    *.md              Agent definitions (frontmatter + system prompt)
    agent-chain.yaml  Chain pipeline definitions
  presets.json        Optional project prompt presets
mcp.json              Project MCP server config
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
