# Package releases

Package releases are run locally by the repository owner using an
interactive npm login. GitHub Actions, GitHub Releases, and automatic
Git pushes are not part of the publishing process.

Before releasing, log in to npm and confirm the active account:

```bash
npm login
npm whoami
```

From `main`, with the intended Changesets committed, run:

```bash
pnpm run version && pnpm run format && git add . && git commit -m "chore: bump version" && pnpm run release
```

`pnpm run version` applies pending Changesets and regenerates the
package preview. `pnpm run release` requires a clean Git state, builds
the packages, and runs `changeset publish`. Publishing creates local
package tags; pushing the version commit and tags remains a separate,
explicit owner action.

This local workflow uses the npm credentials from the owner's active
session. It does not use GitHub OIDC trusted publishing or create npm
provenance through a GitHub-hosted runner.
