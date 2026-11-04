# Pi Extension Package Checklist

## New package

- `packages/<name>/package.json`
  - package name is `@spences10/<name>`
  - has `type: module`
  - exposes and publishes `dist/index.js`
  - declares `pi.extensions: ["./dist/index.js"]` so standalone Pi
    discovers the compiled entrypoint
  - declares imported host packages (`@earendil-works/pi-ai`,
    `@earendil-works/pi-agent-core`,
    `@earendil-works/pi-coding-agent`, `@earendil-works/pi-tui`, and
    `typebox`) in `peerDependencies` with `"*"` ranges, not in
    `dependencies` or bundled output; use catalog entries in
    `devDependencies` for local builds
  - includes `check:self`, `test:self`, and `build:self` where
    appropriate
- `packages/<name>/src/index.ts`
  - default export accepts Pi extension API
  - pure helpers exported for tests
- `packages/<name>/src/index.test.ts`
- `packages/<name>/README.md`
- `packages/<name>/CHANGELOG.md` if package is versioned

## Add to my-pi

- `packages/my-pi/package.json` dependency points to `workspace:*`.
- `packages/my-pi/src/extensions.ts` lists it; update
  `extensions.test.ts`.
- Root lockfile updated with `pnpm install` when dependencies change.

## Validation

Run targeted checks first:

```bash
pnpm --filter @spences10/<name> run check
pnpm --filter @spences10/<name> run test
```

These scripts build transitive dependencies first. Use `check:self`
and `test:self` only when those dependencies are already built and
their inputs are unchanged.

If root files or registry changed:

```bash
pnpm run check
```

Use LSP diagnostics on changed TypeScript files when available;
package checks remain required when the LSP extension is disabled.
