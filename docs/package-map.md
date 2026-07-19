# Package map

`my-pi` can be run as a full distribution with `pnpx my-pi@latest`,
while most `@spences10/pi-*` packages can also be installed into
vanilla Pi.

## User-installable extension packages

| Package                             | Purpose                                                       |
| ----------------------------------- | ------------------------------------------------------------- |
| `@spences10/pi-coding-preferences`  | Configurable coding-workflow guardrails.                      |
| `@spences10/pi-confirm-destructive` | Destructive action confirmations.                             |
| `@spences10/pi-context`             | SQLite FTS sidecar for oversized tool output.                 |
| `@spences10/pi-codex-usage`         | OpenAI Codex usage in the footer status area.                 |
| `@spences10/pi-factory`             | Reusable software-factory control plane.                      |
| `@spences10/pi-git-ui`              | Interactive source-control staging UI.                        |
| `@spences10/pi-lsp`                 | LSP diagnostics, hover, definitions, references, and symbols. |
| `@spences10/pi-mcp`                 | MCP server integration and `/mcp` command.                    |
| `@spences10/pi-nopeek`              | Reminder to use `nopeek` for secret-safe environment loading. |
| `@spences10/pi-observability`       | Live local event stream and browser dashboard.                |
| `@spences10/pi-omnisearch`          | Reminder to use `mcp-omnisearch` for verified web research.   |
| `@spences10/pi-recall`              | `pirecall` reminder and background sync.                      |
| `@spences10/pi-redact`              | Output redaction and `/redact-stats`.                         |
| `@spences10/pi-harness`             | Ephemeral task harness runtime.                               |
| `@spences10/pi-skills`              | Skill management, discovery, profiles, import, and sync.      |
| `@spences10/pi-sqlite-tools`        | Reminder to use `mcp-sqlite-tools` for safer SQLite work.     |
| `@spences10/pi-svelte-guardrails`   | Svelte pattern guardrails.                                    |
| `@spences10/pi-team-mode`           | Peer-session coordination, groups, artifacts, and mailboxes.  |
| `@spences10/pi-telemetry`           | Local SQLite telemetry and `/telemetry`.                      |
| `@spences10/pi-themes`              | Bundled theme pack for Pi.                                    |

## Shared support packages

These are published as dependencies but are not normally installed
with `pi install` directly:

- `@spences10/pi-child-env`
- `@spences10/pi-footer`
- `@spences10/pi-project-trust`
- `@spences10/pi-settings`
- `@spences10/pi-skill-importer`
- `@spences10/pi-sqlite-core`
- `@spences10/pi-tui-modal`

Check each package README before changing install instructions,
commands, or public behavior.
