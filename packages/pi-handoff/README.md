# @spences10/pi-handoff

[![built with Vite+](https://img.shields.io/badge/built%20with-Vite+-646CFF?logo=vite&logoColor=white)](https://viteplus.dev)
[![tested with Vitest](https://img.shields.io/badge/tested%20with-Vitest-6E9F18?logo=vitest&logoColor=white)](https://vitest.dev)
[![npm version](https://img.shields.io/npm/v/@spences10/pi-handoff?color=CB3837&logo=npm&logoColor=white)](https://www.npmjs.com/package/@spences10/pi-handoff)
[![license](https://img.shields.io/npm/l/@spences10/pi-handoff)](https://www.npmjs.com/package/@spences10/pi-handoff)

![my-pi package preview](https://raw.githubusercontent.com/spences10/my-pi/main/assets/pi-package-preview.png)

Create portable continuation packets instead of bloating the current
session. `pi-handoff` reminds the model to turn requests like “handoff
this to Alice and keep going here” into focused markdown handoffs for
later sessions, teammate sessions, or return findings.

Inspired by Matt Pocock's `/handoff` skill and his framing of handoff
files as a lightweight DIY subagent protocol: send focused context
out, let another session do the work, then bring compressed findings
back.

## Installation

```bash
pi install npm:@spences10/pi-handoff
```

Local development from this monorepo:

```bash
pnpm --filter @spences10/pi-handoff run build
pi install ./packages/pi-handoff
# or for one run only
pi -e ./packages/pi-handoff
```

## What it does

- injects a system reminder for handoff-style continuation workflows
- teaches the model to create focused markdown handoff artifacts
- prefers disposable OS temp handoffs unless the user asks for repo
  docs
- tells the model to redact secrets, credentials, tokens, passwords,
  and PII
- integrates by instruction with team-mode tools when they are
  available
- adds no slash commands and no custom tools

## Model reminder

The injected reminder tells the model to treat user requests to hand
off, park, delegate, continue later, or send work to a teammate as
portable continuation requests.

Examples:

```text
handoff this to Alice and keep going here
park this so I can resume tomorrow
send this to another session to prototype the risky bit
come back with a return handoff summarizing what changed
```

For team-mode, the reminder asks the model to create or update a task,
send the teammate a message with the handoff, and request a return
handoff with findings, changed files, validation, and recommendations.

## Using from a custom harness

```ts
import handoff from '@spences10/pi-handoff';

// pass `handoff` as an ExtensionFactory to your Pi runtime
```

`my-pi` imports this package directly and enables it as the built-in
handoff reminder.

## Development

Package scripts build transitive workspace dependencies first, then
run local tools through Vite+ with `vp exec`.

```bash
pnpm --filter @spences10/pi-handoff run check
pnpm --filter @spences10/pi-handoff run test
pnpm --filter @spences10/pi-handoff run build
```

## Credit

Inspired by Matt Pocock's public handoff skill and video discussion of
handoffs as markdown-based context transfer between agent sessions.

## License

MIT
