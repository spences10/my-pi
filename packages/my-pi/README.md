# my-pi

Scott Spence's Pi: upstream [Pi](https://pi.dev) with these extensions
built in.

| Key                   | Package                                                                                                         |
| --------------------- | --------------------------------------------------------------------------------------------------------------- |
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

## Turn extensions on or off

```text
/extensions                 Open the switchboard
/extensions list            Show each extension and its state
/extensions disable <key>   Turn one off (enable to turn it back on)
```

Changes save to `~/.pi/agent/my-pi-settings.json` and apply on reload.
Themes apply on the next start.

Everything else (MCP, skills, models, sessions, `my-pi config`,
`my-pi install`) is upstream Pi: every Pi option and subcommand works.
