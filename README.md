# my-pi

[![built with vite+](https://img.shields.io/badge/built%20with-Vite+-646CFF?logo=vite&logoColor=white)](https://viteplus.dev)
[![tested with vitest](https://img.shields.io/badge/tested%20with-Vitest-6E9F18?logo=vitest&logoColor=white)](https://vitest.dev)

Composable [pi](https://pi.dev) coding agent for humans and agents.

Built on the
[@mariozechner/pi-coding-agent](https://github.com/badlogic/pi-mono)
SDK. Adds MCP server support, extension stacking, LSP tools, prompt
presets, local SQLite telemetry for evals, and a programmatic API.

Extension stacking patterns inspired by
[pi-vs-claude-code](https://github.com/disler/pi-vs-claude-code).

## Features

- **Pi-native CLI + SDK wrapper** — interactive TUI, print mode, JSON
  mode, and programmatic runtime creation.
- **MCP integration** — stdio and HTTP/streamable-HTTP servers from
  `mcp.json`, auto-registered as Pi tools.
- **Built-in LSP tools** — diagnostics, hover, definitions,
  references, and document symbols via language servers.
- **Managed skills** — discover, enable, disable, import, and sync
  Pi-native skills.
- **Prompt presets** — base presets plus additive prompt layers with
  per-project persistence.
- **Secret redaction** — redact API keys and other sensitive output
  before the model sees tool results.
- **Recall** — teach the model to use `pirecall` for prior-session
  context.
- **Local telemetry** — optional SQLite telemetry for evals, tool
  analysis, and operational debugging.
- **Bundled themes + extension stacking** — ship defaults, then layer
  extra project or ad-hoc extensions on top.

## Get Started

```bash
pnpx my-pi@latest
# or: npx my-pi@latest / bunx my-pi@latest
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
pnpx my-pi@latest
```

Pi's full terminal UI with editor, `/commands`, model switching
(`Ctrl+L`), session tree (`/tree`), and message queuing.

### Print mode (one-shot)

```bash
pnpx my-pi@latest "your prompt here"
pnpx my-pi@latest -P "explicit print mode"
# or: npx my-pi@latest ... / bunx my-pi@latest ...
```

### JSON output (for agents)

```bash
pnpx my-pi@latest --json "list all TODO comments"
echo "plan a login page" | pnpx my-pi@latest --json
```

Outputs NDJSON events — one JSON object per line — for programmatic
consumption by other agents or scripts.

In non-interactive modes (`"prompt"`, `-P`, `--json`), my-pi keeps
headless-capable built-ins like MCP, LSP, prompt presets, recall,
hooks, and secret filtering enabled, while skipping UI-only built-ins
like session auto-naming.

### Local telemetry (SQLite)

Telemetry is **disabled by default**. When enabled, my-pi records
operational telemetry for each run in a local SQLite database. This is
intended for eval harnesses, latency analysis, tool failure analysis,
and local debugging.

```bash
pnpx my-pi@latest --telemetry --json "solve this task"
pnpx my-pi@latest --telemetry --telemetry-db ./tmp/evals.db --json "run case"
```

By default the database lives at:

```text
~/.pi/agent/telemetry.db
```

You can relocate the whole Pi auth/config/session directory for
sandboxed or CI runs with either:

```bash
pnpx my-pi@latest --agent-dir /work/pi-agent --telemetry --json "run case"
```

or:

```bash
PI_CODING_AGENT_DIR=/work/pi-agent pnpx my-pi@latest --telemetry --json "run case"
```

Use the interactive command to inspect or persist the setting:

```text
/telemetry status
/telemetry stats
/telemetry query run=<eval-run-id> success=true limit=10
/telemetry export ./tmp/eval-runs.json suite=smoke
/telemetry on
/telemetry off
/telemetry path
```

Recommended eval env vars for correlation:

- `MY_PI_EVAL_RUN_ID`
- `MY_PI_EVAL_CASE_ID`
- `MY_PI_EVAL_ATTEMPT`
- `MY_PI_EVAL_SUITE`

Recorded tables:

- `runs`
- `turns`
- `tool_calls`
- `provider_requests`

Query and export helpers:

- `/telemetry query ...` shows recent run summaries
- `/telemetry export [path] ...` writes matching runs as JSON
- supported filters: `run=` / `eval_run_id=`, `case=` /
  `eval_case_id=`, `suite=` / `eval_suite=`,
  `success=true|false|null`, `limit=<n>`
- `/telemetry query` defaults to `limit=20`
- `/telemetry export` auto-generates a timestamped JSON file when no
  path is provided

Schema notes:

- source of truth: `packages/pi-telemetry/src/schema.sql`
- current telemetry schema version: `1`
- schema version is tracked with `PRAGMA user_version`
- unversioned local telemetry databases are initialized/upgraded to v1
  on open
- newer unsupported schema versions fail fast instead of silently
  downgrading
- opens the database in WAL mode: `PRAGMA journal_mode = WAL`
- waits up to 5s on lock contention: `PRAGMA busy_timeout = 5000`

CLI flags `--telemetry` and `--no-telemetry` override only the current
process. `/telemetry on` and `/telemetry off` update the saved default
for future sessions.

### Sandbox / CI auth and config isolation

If you run my-pi in containers, CI, or ephemeral sandboxes, changing
`HOME` often hides the usual `~/.pi/agent/auth.json` credentials. Use
a stable agent directory instead of relying on `HOME` alone.

Recommended options:

1. Pass provider API keys directly via environment variables.
2. Set `--agent-dir /path/to/pi-agent` for the process.
3. Or set `PI_CODING_AGENT_DIR=/path/to/pi-agent` in the environment.

The agent directory holds Pi-managed state such as:

- `auth.json`
- `settings.json`
- `sessions/`
- `telemetry.db`
- `telemetry.json`

A practical sandbox command looks like:

```bash
PI_CODING_AGENT_DIR=/work/pi-agent \
ANTHROPIC_API_KEY=... \
pnpx my-pi@latest --telemetry --json "run eval case"
```

### Extension stacking

```bash
pnpx my-pi@latest -e ./ext/damage-control.ts -e ./ext/tool-counter.ts
pnpx my-pi@latest --no-builtin -e ./ext/custom.ts "do something"
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
echo "review this code" | pnpx my-pi@latest
cat plan.md | pnpx my-pi@latest --json
```

When stdin is piped, it's read as the prompt and print mode runs
automatically.

### Programmatic API

```ts
import { create_my_pi, runPrintMode } from 'my-pi';

const runtime = await create_my_pi({
	agent_dir: './tmp/pi-agent',
	extensions: ['./my-ext.ts'],
	runtime_mode: 'json',
	telemetry: true,
	telemetry_db_path: './tmp/evals.db',
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
		"my-http-mcp": {
			"type": "http",
			"url": "https://myproject.com/api/mcp",
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
- `/extensions enable|disable|toggle` — without a key, open the
  interactive toggle list
- `/extensions enable <key>` / `/extensions disable <key>` — toggle a
  built-in extension
- `/skills` — open the interactive skills manager (unified list with
  managed and importable sections, checkbox batch-import)
- `/skills import <key|name>` — import an external skill from the
  command line
- `/skills sync <key|name>` — sync an imported skill to its upstream
- `/skills refresh` — rescan skill directories
- `/skills defaults <all-enabled|all-disabled>` — set default policy
- `/prompt-preset` — open the prompt preset manager (base presets +
  layers); `/preset` is a short alias
- `/prompt-preset help` — show examples and common prompt preset
  commands
- `/prompt-preset <name>` — activate a base preset or toggle a layer
- `/prompt-preset base <name>` — activate a base preset directly
- `/prompt-preset enable <layer>` / `/prompt-preset disable <layer>` —
  toggle a prompt layer directly
- `/prompt-preset edit <name>` — edit or create a project preset in
  `.pi/presets/<name>.md`
- `/prompt-preset edit-global <name>` — edit or create a global preset
  in `~/.pi/agent/presets/<name>.md`
- `/prompt-preset export-defaults` — copy built-in presets to editable
  global Markdown files
- `/prompt-preset export-defaults project` — copy built-in presets to
  editable project Markdown files
- `/prompt-preset delete <name>` — delete a project-local preset
- `/prompt-preset reset <name>` — remove a project-local override and
  fall back to user/built-in if available
- `/prompt-preset clear` — clear the active base preset and all layers
- `/lsp status|list|restart` — inspect or restart language server
  state
- `/redact-stats` — show how many secrets were redacted this session
- `/telemetry status|stats|query|export|on|off|path` — inspect, query,
  export, or toggle local SQLite telemetry

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
3. `~/.pi/agent/presets/*.md`
4. `.pi/presets.json`
5. `.pi/presets/*.md`

Project presets override global/default presets with the same name.
Strings in JSON are treated as base presets by default. Object entries
may set `kind: "base"` or `kind: "layer"`. Markdown preset files use
the filename as the preset name and optional frontmatter:

```markdown
---
kind: base
description: Short, direct, no fluff
---

Be concise and direct.
```

Use `/prompt-preset export-defaults` to copy built-in presets to
`~/.pi/agent/presets/*.md` for editing, or
`/prompt-preset export-defaults project` to write `.pi/presets/*.md`.
`/prompt-preset edit <name>` writes a project Markdown preset;
`/prompt-preset edit-global <name>` writes a global one. `/preset` is
a short alias for `/prompt-preset`.

CLI layering is supported too:

- `--preset terse,no-purple-prose,bullets`
- `--system-prompt "You are terse and technical."`
- `--append-system-prompt "Prefer one short paragraph."`

Interactive sessions default to `terse` unless a project has a saved
selection. `/preset` selections are restored on later sessions for the
same project via `~/.pi/agent/prompt-preset-state.json`;
`/preset clear` persists no active preset for that project.

This repo also includes an example `.pi/presets.json` with sample base
presets and layers.

## LSP Integration

The built-in LSP extension adds Pi tools for:

- diagnostics
- hover
- definitions
- references
- document symbols

You still need the underlying language server binaries installed.
`my-pi` prefers project-local binaries from `node_modules/.bin` and
otherwise falls back to whatever is on `PATH`.

For the main TypeScript / JavaScript / Svelte workflow, install:

```bash
pnpm add -D typescript typescript-language-server svelte-language-server
```

That covers:

- TypeScript / JavaScript via `typescript-language-server`
- Svelte via `svelteserver`

`my-pi` can also use other language servers if you already have them
installed and available on `PATH`, including:

- Python via `python-lsp-server`
- Go via `gopls`
- Rust via `rust-analyzer`
- Ruby via `solargraph`
- Java via `jdtls`
- Lua via `lua-language-server`

Use `/lsp status` to inspect active server state and
`/lsp restart all` or `/lsp restart <language>` to clear cached
clients.

## Session Recall

The recall package nudges the model to use `pnpx pirecall` or
`npx pirecall` when the user references prior work or when historical
project context would help. It also triggers `pirecall sync --json` on
session start and shutdown when the local recall database exists.

## Reusable Pi packages

This repo is a pnpm workspace. The `my-pi` harness depends on reusable
Pi packages via `workspace:*`, and those packages can also be
published and installed into vanilla `pi` independently:

```bash
pi install npm:@spences10/pi-redact
pi install npm:@spences10/pi-telemetry
pi install npm:@spences10/pi-mcp
pi install npm:@spences10/pi-lsp
pi install npm:@spences10/pi-confirm-destructive
pi install npm:@spences10/pi-skills
pi install npm:@spences10/pi-recall
pi install npm:@spences10/pi-nopeek
```

- [`@spences10/pi-redact`](./packages/pi-redact/README.md) — output
  redaction and `/redact-stats`
- [`@spences10/pi-telemetry`](./packages/pi-telemetry/README.md) —
  local SQLite telemetry and `/telemetry`
- [`@spences10/pi-mcp`](./packages/pi-mcp/README.md) — MCP server
  integration and `/mcp`
- [`@spences10/pi-lsp`](./packages/pi-lsp/README.md) — LSP-backed
  diagnostics and symbol tools
- [`@spences10/pi-confirm-destructive`](./packages/pi-confirm-destructive/README.md)
  — destructive action confirmations
- [`@spences10/pi-skills`](./packages/pi-skills/README.md) — skill
  management, import, and sync
- [`@spences10/pi-recall`](./packages/pi-recall/README.md) — pirecall
  reminder and background sync
- [`@spences10/pi-nopeek`](./packages/pi-nopeek/README.md) — nopeek
  reminder for secret-safe environment loading

Each package README is the entry point for install instructions,
commands, runtime behavior, and development notes.

## Project Structure

```
src/
  index.ts                 CLI entry point (citty + pi SDK)
  api.ts                   Programmatic API (create_my_pi + re-exports)
  extensions/
    manager/               Built-in extension manager and config
    prompt-presets/        Runtime prompt preset selection and editing
    session-name/          Session auto-naming
    hooks-resolution/      Claude-style hook resolution
packages/
  pi-redact/               Installable Pi package for output redaction
  pi-telemetry/            Installable Pi package for SQLite telemetry
  pi-mcp/                  Installable Pi package for MCP integration
  pi-lsp/                  Installable Pi package for LSP tools
  pi-confirm-destructive/  Installable Pi package for destructive action confirmations
  pi-skills/               Installable Pi package for skill management
  pi-recall/               Installable Pi package for pirecall reminders
  pi-nopeek/               Installable Pi package for nopeek reminders
.pi/
  presets.json             Optional project prompt presets (JSON)
  presets/*.md             Optional project prompt presets (Markdown files)
mcp.json                   Project MCP server config
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
