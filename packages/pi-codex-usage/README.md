# @spences10/pi-codex-usage

Pi extension that publishes OpenAI Codex usage to the footer status
area.

It only shows status when the active model provider is `openai-codex`.
The extension reads `~/.pi/agent/auth.json` for `openai-codex.access`,
calls the Codex usage endpoint, and publishes a compact `codex-usage`
status for the existing `@spences10/pi-footer` renderer.

Disable the built-in with:

```bash
my-pi --no-codex-usage
```
