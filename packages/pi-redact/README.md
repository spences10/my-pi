# @spences10/pi-redact

[![built with vite+](https://img.shields.io/badge/built%20with-Vite+-646CFF?logo=vite&logoColor=white)](https://viteplus.dev)
[![tested with vitest](https://img.shields.io/badge/tested%20with-Vitest-6E9F18?logo=vitest&logoColor=white)](https://vitest.dev)

Pi extension that redacts likely secrets from tool output before the
model sees them.

## Install

```bash
pi install npm:@spences10/pi-redact
```

Local development from this monorepo:

```bash
pnpm --filter @spences10/pi-redact run build
pi install ./packages/pi-redact
# or for one run only
pi -e ./packages/pi-redact
```

## What it does

`@spences10/pi-redact` listens for Pi `tool_result` events and
rewrites text content before it is added to model context. It is
intended as a last-mile safety net for accidental secrets in command
output, file reads, logs, and config files.

It currently detects and redacts:

- API-key-like fields such as `password`, `secret`, `token`, and
  `api_key`
- GitHub classic and fine-grained tokens
- Tavily, Kagi, Brave, and Firecrawl API keys
- connection strings with embedded credentials
- SSH config metadata such as `Host`, `HostName`, `User`,
  `IdentityFile`, `ProxyJump`, and forwarding directives

Redactions preserve a short prefix where helpful and append a marker
such as `[REDACTED:GitHub Token]`.

## Commands

### `/redact-stats`

Shows how many values were redacted in the current Pi session.

```text
/redact-stats
```

## Example

If a tool returns:

```text
GITHUB_TOKEN=ghp_abcdefghijklmnopqrstuvwxyz1234567890
```

The model receives something like:

```text
GITH********************[REDACTED:GitHub Token]
```

## Using from a custom harness

```ts
import redact from '@spences10/pi-redact';

// pass `redact` as an ExtensionFactory to your Pi runtime
```

`my-pi` imports this package directly and enables it as the built-in
`filter-output` extension.

## Limitations

This extension is defensive, not a guarantee. It can miss novel secret
formats, and broad patterns can occasionally redact benign values. Use
proper secret hygiene as the primary control:

- do not print secrets unnecessarily
- avoid reading `.env` files into model context
- prefer scoped, revocable tokens
- rotate anything that may have been exposed

## Development

```bash
pnpm --filter @spences10/pi-redact run check
pnpm --filter @spences10/pi-redact run test
pnpm --filter @spences10/pi-redact run build
```

## License

MIT
