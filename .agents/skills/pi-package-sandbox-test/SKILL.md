---
name: pi-package-sandbox-test
# prettier-ignore
description: Use when verifying that published Pi packages from this repository install and load for normal Pi users without the repository wrapper. Applies to pi.dev package compatibility checks, release validation, Daytona sandbox tests, and package installability audits.
# prettier-ignore
compatibility: Requires Node.js, pnpx, network access, ralph-town Daytona sandbox access, npm registry access, and vanilla Pi via @earendil-works/pi-coding-agent.
---

# Pi Package Sandbox Test

Verify published packages work for normal Pi users, independent of `my-pi`.

## Procedure

1. From the repository root, enumerate `packages/*/package.json`.
2. Select only packages with a `pi` manifest; helper/internal packages without `pi` are not user-installable Pi packages.
3. For each selected package, compare local `package.json` version with `npm view <pkg> version`.
4. In a disposable Daytona sandbox via `pnpx ralph-town run`, use vanilla Pi only:
   ```bash
   pnpx @earendil-works/pi-coding-agent
   ```
5. For each published npm version, verify both commands succeed:
   ```bash
   pnpx @earendil-works/pi-coding-agent install npm:<package>@<npm-version>
   pnpx @earendil-works/pi-coding-agent -e npm:<package>@<npm-version> --help
   ```
6. In the same clean sandbox config, install all selected packages together, then run:
   ```bash
   pnpx @earendil-works/pi-coding-agent list
   pnpx @earendil-works/pi-coding-agent --help
   ```

## Report Format

Report a compact table with:

- package name
- local version
- npm version
- install result
- ephemeral load result
- notes

Call out local/npm version drift separately. Version drift is not a failure when it is explained by release timing, changesets, or `minimumReleaseAge`; the user-facing check should use the published npm version that normal Pi users can install.

## Failure Patterns

Treat these as failures unless explained by the sandbox environment:

- npm package cannot be resolved
- `pi install npm:<package>@<version>` exits non-zero
- `pi -e npm:<package>@<version> --help` exits non-zero
- startup output includes `Cannot find module`, `ERR_MODULE_NOT_FOUND`, `SyntaxError`, `TypeError`, or `ReferenceError`
- packages pass alone but fail when installed together
