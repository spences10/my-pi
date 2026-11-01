---
name: my-pi-nopeek
# prettier-ignore
description: Use when loading .env credentials, running authenticated commands, or keeping secret values out of Pi context.
compatibility: Requires Pi with shell access and the nopeek CLI.
---

# Credential-dependent commands

Use the nopeek CLI to reduce accidental disclosure. This skill does
not install hooks, load credentials automatically, or guarantee safe
output.

1. Inspect key names with `pnpx nopeek list` or `pnpx nopeek status`;
   never read secret files into model context.
2. In pnpm projects use `pnpx nopeek`; otherwise use `npx nopeek`.
3. Prefer one-shot execution with an explicit key allowlist:

   ```bash
   pnpx nopeek run .env --only DATABASE_URL -- sh -c 'psql "$DATABASE_URL" -c "select 1"'
   ```

4. Keep variable expansion inside the child shell. Do not print keys,
   run `env`/`printenv`, enable tracing, or place secret values in
   arguments.
5. Review what the child command prints: nopeek cannot prevent
   arbitrary applications from leaking credentials through stdout or
   stderr.
6. Use `nopeek load` only with confirmed persistent harness injection,
   or when loading and execution happen in the same trusted shell. A
   source-file result does not persist into another Pi tool call.
7. Use `pnpx nopeek audit` for exposure and gitignore checks.

Pi's redaction extension is a separate best-effort safety net, not a
security boundary. If secret output is unavoidable, stop and agree on
a safer workflow rather than exposing it.

The CLI must be available through the user's package runner or
installed locally. Do not change their credential storage or
configuration implicitly. See
[nopeek's threat model](https://github.com/spences10/nopeek#threat-model-and-non-goals).
