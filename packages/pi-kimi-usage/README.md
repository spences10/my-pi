# @spences10/pi-kimi-usage

Pi extension that publishes Kimi For Coding usage to the footer status
area.

It only shows status when the active model provider is `kimi-coding`.
The extension reads `~/.pi/agent/auth.json` for the `kimi-coding`
credential (OAuth `access` token or API key, falling back to the
`KIMI_API_KEY` environment variable), calls the Kimi Code usage
endpoint (`GET https://api.kimi.com/coding/v1/usages`), and publishes
a compact `kimi-usage` status for the existing `@spences10/pi-footer`
renderer.

The status shows the 5-hour rolling window first, then the weekly
quota, each as used percent with a compact reset time, e.g.
`kimi 4h 7% · 5d 4%`. The footer shows `kimi ?` when the credential is
expired or the endpoint is unreachable; OAuth tokens are refreshed by
Pi's built-in provider and picked up here on the next poll.

Disable the built-in with:

```bash
my-pi --no-kimi-usage
```
