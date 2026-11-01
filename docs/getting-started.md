---
title: Getting started
tags: [setup, configuration, extensions]
aliases: [Quick start]
---

# Getting started

## Run the full collection

Use Node.js `>=24.15.0`, as declared in the
[launcher manifest](../packages/my-pi/package.json):

```bash
pnpx --allow-build=@google/genai --allow-build=protobufjs my-pi@latest
```

This runs the published launcher, not your local checkout. It starts
upstream Pi with my-pi's bundled extensions. For model authentication
and Pi options, follow [Pi's documentation](https://pi.dev) and
inspect:

```bash
pnpx my-pi@latest --help
```

## Choose extensions

Inside an interactive session:

```text
/extensions
/extensions list
/extensions disable starfield
/extensions enable starfield
/reload
```

The switchboard saves choices globally in
`~/.pi/agent/my-pi-settings.json` by default. Changes apply when
extensions reload; theme changes take effect on the next start. The
[launcher README](../packages/my-pi/README.md) lists extension keys,
and the [package map](./package-map.md) links to configuration and
prerequisites.

Enabling an extension is different from enabling every feature it
offers. For example, the telemetry extension can be loaded while
recording remains off; use `/telemetry on` to opt in. Session
autonaming makes an additional model request. See the
[telemetry](../packages/pi-telemetry/README.md) and
[session-name](../packages/pi-session-name/README.md) READMEs.

## Install only what you want

If you already use Pi, install individual packages instead:

```bash
pi install npm:@spences10/pi-lsp
```

Package READMEs explain additional setup, such as language servers for
[LSP](../packages/pi-lsp/README.md) or audio/provider requirements for
[dictation](../packages/pi-talk/README.md). The shared support
packages in the
[package map](./package-map.md#shared-support-packages) are
dependencies rather than standalone extensions.

## Where configuration lives

There are two different settings stores:

| Store                         | Used for                                                             |
| ----------------------------- | -------------------------------------------------------------------- |
| Pi's settings and `pi config` | Upstream packages, resources, models, and MCP configuration          |
| `my-pi-settings.json`         | The extension switchboard and namespaced my-pi extension preferences |

The my-pi store uses Pi's agent directory resolver; the home-directory
path above is the default, not a hard-coded requirement. See
[pi-settings](../packages/pi-settings/README.md) for the distinction,
and each package README for its own saved state or environment
variables.

## If something is missing

- Check `/extensions list`, then reload after changing a switch.
- Confirm the package's prerequisites in its README.
- For MCP, codemode, skills, and general session configuration, use
  Pi's own help and docs rather than instructions for removed my-pi
  implementations.
- For checkout changes, build and run
  `node packages/my-pi/dist/index.js`; `pnpx my-pi@latest` still runs
  the published version. See [Development](./development.md).

Local session files, diagnostics, dashboard URLs carrying tokens, and
telemetry exports can contain private information. Share a small,
reviewed reproduction rather than an entire local archive.
