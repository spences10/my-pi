---
name: pi-package-sandbox-test
# prettier-ignore
description: Use when verifying that published Pi packages install and load for normal users, including pi.dev package compatibility checks, release validation, isolated startup tests, and package installability audits.
compatibility:
  Requires Node.js, pnpx, npm registry access, a disposable test
  environment, and vanilla Pi via @earendil-works/pi-coding-agent.
---

# Pi Package Sandbox Test

Verify published packages work for normal Pi users, independent of
`my-pi`.

## Procedure

1. From the repository root, enumerate `packages/*/package.json`.
2. Select packages exposing Pi resources through a `pi` manifest or
   conventional `extensions/`, `skills/`, `prompts/`, or `themes/`
   directories. Current repository packages use explicit manifests;
   exclude the launcher and support libraries without Pi resources.
3. For each selected package, compare local `package.json` version
   with `npm view <pkg> version`.
4. Choose an exact upstream Pi version for the compatibility target
   and set `PI_VERSION` to it in the test shell. Use the same pin for
   every invocation and record it in the report. Run vanilla Pi in a
   disposable container, VM, or sandbox; Daytona via
   `pnpx ralph-town run` is one option, not a requirement. Work
   outside the checkout and personal resource directories:
   ```bash
   pnpx "@earendil-works/pi-coding-agent@$PI_VERSION" --version
   ```
5. Export a fresh `PI_CODING_AGENT_DIR` for each package. For its
   published npm version, install it and start an ephemeral RPC
   session without making a model request:
   ```bash
   pnpx "@earendil-works/pi-coding-agent@$PI_VERSION" install npm:<package>@<npm-version>
   printf '%s\n' '{"id":"startup","type":"get_state"}' | pnpx "@earendil-works/pi-coding-agent@$PI_VERSION" -e npm:<package>@<npm-version> --mode rpc --no-session
   ```
6. Export a separate fresh `PI_CODING_AGENT_DIR` for the combined
   check. Install all selected packages together with the pinned Pi,
   then run:
   ```bash
   pnpx "@earendil-works/pi-coding-agent@$PI_VERSION" list
   printf '%s\n' '{"id":"startup","type":"get_state"}' | pnpx "@earendil-works/pi-coding-agent@$PI_VERSION" --mode rpc --no-session
   ```

For each RPC check, capture stdout and stderr and apply a bounded
startup timeout. Require exit code zero, a `response` with
`id: "startup"`, `command: "get_state"`, and `success: true`, and no
`extension_error` records or load failures in stderr. A successful
state response alone does not prove extension startup succeeded.
Closing stdin requests orderly shutdown. Never send a `prompt` for
this check; credentials and model inference are not required.

`--help` is only a CLI-help smoke test: upstream can exit zero while
hiding extension-load diagnostics. It is not evidence of successful
loading or `session_start`. RPC does not exercise TUI-only behavior;
check declared skills, prompts, and themes separately when applicable.

## Report Format

Record the exact upstream Pi version and isolation environment, then
report a compact table with:

- package name
- local version
- npm version
- install result
- ephemeral RPC startup result
- notes

Call out local/npm version drift separately. Version drift is not a
failure when it is explained by release timing, changesets, or
`minimumReleaseAge`; the user-facing check should use the published
npm version that normal Pi users can install.

## Failure Patterns

Treat these as failures unless explained by the sandbox environment:

- npm package cannot be resolved
- `pi install npm:<package>@<version>` exits non-zero
- RPC startup exits non-zero, times out, or lacks the successful
  `startup` state response
- RPC emits `extension_error`, even if its exit code is zero
- startup output includes `Failed to load extension`,
  `Cannot find module`, `ERR_MODULE_NOT_FOUND`, `SyntaxError`,
  `TypeError`, or `ReferenceError`
- packages pass alone but fail when installed together
