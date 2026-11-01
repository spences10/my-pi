# Pi Extension Package Checklist

## New package

- `packages/<name>/package.json`
  - package name is `@spences10/<name>`
  - has `type: module`
  - exposes `dist/index.js`
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
pnpm --filter @spences10/<name> run check:self
pnpm --filter @spences10/<name> run test:self
```

If root files or registry changed:

```bash
pnpm run check
```

Use LSP diagnostics on changed TypeScript files before reporting
completion.
