---
title: Package map
tags: [packages, extensions]
aliases: [Extension catalog]
---

# Package map

Use [my-pi](../packages/my-pi/README.md) for the complete switchable
collection, or install individual extension packages into Pi:

```bash
pi install npm:@spences10/pi-lsp
```

See [Getting started](./getting-started.md) for the launcher command
and extension switchboard. Each linked README describes that package's
prerequisites, commands, options, and local development.

## User-installable packages

### Coding tools and output

| Package                                                                | Purpose                                              |
| ---------------------------------------------------------------------- | ---------------------------------------------------- |
| [pi-lsp](../packages/pi-lsp/README.md)                                 | Language-server diagnostics, navigation, and symbols |
| [pi-context](../packages/pi-context/README.md)                         | Searchable overflow cache for oversized tool output  |
| [pi-redact](../packages/pi-redact/README.md)                           | Redaction of likely secrets in tool output           |
| [pi-confirm-destructive](../packages/pi-confirm-destructive/README.md) | Destructive shell action confirmations               |
| [pi-coding-preferences](../packages/pi-coding-preferences/README.md)   | Configurable coding-workflow guardrails              |
| [pi-svelte-guardrails](../packages/pi-svelte-guardrails/README.md)     | Svelte pattern guardrails                            |
| [pi-tool-guidance](../packages/pi-tool-guidance/README.md)             | Native skills and prompt guidance for external tools |

### Sessions and workflows

| Package                                                  | Purpose                                                |
| -------------------------------------------------------- | ------------------------------------------------------ |
| [pi-recall](../packages/pi-recall/README.md)             | Session-history reminders and background pirecall sync |
| [pi-team-mode](../packages/pi-team-mode/README.md)       | Coordination between independently opened sessions     |
| [pi-harness](../packages/pi-harness/README.md)           | Optional task contracts and validation scaffolding     |
| [pi-git-ui](../packages/pi-git-ui/README.md)             | Interactive staging and diff review                    |
| [pi-session-name](../packages/pi-session-name/README.md) | Model-generated names for unnamed sessions             |
| [pi-turn-timer](../packages/pi-turn-timer/README.md)     | Live timing and persisted completion durations         |

### Visibility and interface

| Package                                                    | Purpose                                       |
| ---------------------------------------------------------- | --------------------------------------------- |
| [pi-observability](../packages/pi-observability/README.md) | Live event stream and local browser dashboard |
| [pi-telemetry](../packages/pi-telemetry/README.md)         | Opt-in durable local run metrics              |
| [pi-footer](../packages/pi-footer/README.md)               | Configurable footer status line               |
| [pi-codex-usage](../packages/pi-codex-usage/README.md)     | OpenAI Codex usage in the footer              |
| [pi-kimi-usage](../packages/pi-kimi-usage/README.md)       | Kimi For Coding usage in the footer           |
| [pi-talk](../packages/pi-talk/README.md)                   | Hold-Space Deepgram dictation                 |
| [pi-starfield](../packages/pi-starfield/README.md)         | Input stars and suggested next prompt         |
| [pi-themes](../packages/pi-themes/README.md)               | Theme pack                                    |

All names above are published under `@spences10/`. The launcher uses
switchboard keys that sometimes differ from package names: for
example, `context-sidecar` selects `pi-context` and `filter-output`
selects `pi-redact`. The
[launcher README](../packages/my-pi/README.md) lists the keys.

## Shared support packages

These are published dependencies, not normally direct `pi install`
targets:

| Package                                                    | Shared capability                         |
| ---------------------------------------------------------- | ----------------------------------------- |
| [pi-child-env](../packages/pi-child-env/README.md)         | Child-process environment helpers         |
| [pi-project-trust](../packages/pi-project-trust/README.md) | Resource-specific project trust decisions |
| [pi-settings](../packages/pi-settings/README.md)           | Global namespaced my-pi settings          |
| [pi-sqlite-core](../packages/pi-sqlite-core/README.md)     | SQLite database setup and shared helpers  |
| [pi-tui-modal](../packages/pi-tui-modal/README.md)         | TUI modal primitives                      |

This grouping explains the current package roles, not immutable
boundaries. See [Architecture](./architecture.md) for relationships
and [Package README maintenance](./package-readmes.md) when editing
the linked docs.
