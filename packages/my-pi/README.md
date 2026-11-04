# my-pi

Scott Spence's Pi: upstream [Pi](https://pi.dev) with these extensions
built in.

| Key                   | Package                                                                                                         |
| --------------------- | --------------------------------------------------------------------------------------------------------------- |
| `startup-screen`      | Built-in My-Pi splash                                                                                           |
| `filter-output`       | [`pi-redact`](https://github.com/spences10/my-pi/tree/main/packages/pi-redact#readme)                           |
| `confirm-destructive` | [`pi-confirm-destructive`](https://github.com/spences10/my-pi/tree/main/packages/pi-confirm-destructive#readme) |
| `context-sidecar`     | [`pi-context`](https://github.com/spences10/my-pi/tree/main/packages/pi-context#readme)                         |
| `lsp`                 | [`pi-lsp`](https://github.com/spences10/my-pi/tree/main/packages/pi-lsp#readme)                                 |
| `recall`              | [`pi-recall`](https://github.com/spences10/my-pi/tree/main/packages/pi-recall#readme)                           |
| `telemetry`           | [`pi-telemetry`](https://github.com/spences10/my-pi/tree/main/packages/pi-telemetry#readme)                     |
| `observability`       | [`pi-observability`](https://github.com/spences10/my-pi/tree/main/packages/pi-observability#readme)             |
| `team-mode`           | [`pi-team-mode`](https://github.com/spences10/my-pi/tree/main/packages/pi-team-mode#readme)                     |
| `harness`             | [`pi-harness`](https://github.com/spences10/my-pi/tree/main/packages/pi-harness#readme)                         |
| `git-ui`              | [`pi-git-ui`](https://github.com/spences10/my-pi/tree/main/packages/pi-git-ui#readme)                           |
| `turn-timer`          | [`pi-turn-timer`](https://github.com/spences10/my-pi/tree/main/packages/pi-turn-timer#readme)                   |
| `session-name`        | [`pi-session-name`](https://github.com/spences10/my-pi/tree/main/packages/pi-session-name#readme)               |
| `tool-guidance`       | [`pi-tool-guidance`](https://github.com/spences10/my-pi/tree/main/packages/pi-tool-guidance#readme)             |
| `footer`              | [`pi-footer`](https://github.com/spences10/my-pi/tree/main/packages/pi-footer#readme)                           |
| `codex-usage`         | [`pi-codex-usage`](https://github.com/spences10/my-pi/tree/main/packages/pi-codex-usage#readme)                 |
| `kimi-usage`          | [`pi-kimi-usage`](https://github.com/spences10/my-pi/tree/main/packages/pi-kimi-usage#readme)                   |
| `coding-preferences`  | [`pi-coding-preferences`](https://github.com/spences10/my-pi/tree/main/packages/pi-coding-preferences#readme)   |
| `svelte-guardrails`   | [`pi-svelte-guardrails`](https://github.com/spences10/my-pi/tree/main/packages/pi-svelte-guardrails#readme)     |
| `talk`                | [`pi-talk`](https://github.com/spences10/my-pi/tree/main/packages/pi-talk#readme)                               |
| `starfield`           | [`pi-starfield`](https://github.com/spences10/my-pi/tree/main/packages/pi-starfield#readme)                     |
| `themes`              | [`pi-themes`](https://github.com/spences10/my-pi/tree/main/packages/pi-themes#readme)                           |

```bash
pnpx --allow-build=@google/genai --allow-build=protobufjs my-pi@latest
```

## My-Pi splash

The colourful My-Pi logo is back as a header extension, enabled by
default. It shows this package's version, the selected model, and the
current project. Its gradient follows the active theme, including
256-colour terminals; narrow terminals use a compact text header. It
does not change print, JSON, or RPC output.

Use `/builtin-header` to restore Pi's header for the current session,
or `/extensions disable startup-screen` to persist that choice.
Re-enable it with `/extensions enable startup-screen`. Disabling the
extension returns control to Pi's normal startup-header settings.

The shared logo lines are available as `logo_lines` from `my-pi/logo`.
This entrypoint contains only static data and works without building
the CLI, so preview tooling can use the same logo as the splash.

## Session conveniences and tool guidance

`turn-timer` restores live timing and saved completion durations.
`session-name` names unnamed interactive sessions through your
selected model after a successful exchange; this makes an additional
model request. Manual names set with upstream `/name` are never
overwritten. Use `/session-name` to retry generation for an unnamed
session.

`tool-guidance` bundles native skills for nopeek, Omnisearch, and
SQLite, with concise structured prompt reminders. No local maintainer
files, credential setup, or automatic MCP installation are required or
performed. The reminders coexist with user `SYSTEM.md` and
`APPEND_SYSTEM.md`; use normal Pi configuration for the CLI and MCP
servers themselves. When editing and shell tools are reachable,
`tool-guidance` also recommends project language-aware checks,
coordinated through native Codemode when available. See the
[validation workflow](https://github.com/spences10/my-pi/tree/main/packages/pi-tool-guidance#language-aware-validation).

All three are enabled by default and individually switchable below.

## Turn extensions on or off

```text
/extensions                 Open the switchboard
/extensions list            Show each extension and its state
/extensions disable <key>   Turn one off (enable to turn it back on)
```

Changes save to `~/.pi/agent/my-pi-settings.json` and apply on reload.
Themes apply on the next start.

## Release notes after updates

On the next fresh interactive launch after an upgrade, my-pi shows a
single update notice linking to its release notes. The first launch
records the version without notifying. Reloading, continuing a
conversation, and print/JSON/RPC modes leave the notice pending.
Launcher notices use Pi's changelog-version storage, not a separate
state file.

Individually installed extensions ship `CHANGELOG.md`, so Pi shows
newer entries under **Extension Updates**. Pi's `collapseChangelog`
setting condenses those native package notices. Bundled extensions
load as inline factories, which do not carry native package changelog
metadata; the launcher's linked notice covers the my-pi release.

Everything else (MCP, skills, models, sessions, `my-pi config`,
`my-pi install`) is upstream Pi: every Pi option and subcommand works.
