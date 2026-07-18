# Package releases

The supported package-publishing path runs from the GitHub-hosted
workflow in `.github/workflows/publish.yml`. The workflow is manually
dispatched from `main`, validates the repository, and grants only
`contents: read` plus `id-token: write`. npm trusted publishing
exchanges that GitHub OIDC identity for a short-lived publish
credential; no npm token is stored in GitHub.
`NPM_CONFIG_PROVENANCE=true` also makes provenance explicit for the
third-party monorepo publisher. npm currently generates provenance
attestations automatically for public packages published from a public
GitHub repository through trusted publishing.

Versioning remains separate: prepare and merge the normal version
update before dispatching the workflow. The workflow publishes only
package versions that are not already present in npm. Never dispatch
it from a feature branch.

## Required owner setup

Repository code cannot configure npm package ownership or GitHub
deployment protection. Before the first workflow run, an owner must
complete all of the following:

1. Create a GitHub environment named `npm`, restrict it to `main`, and
   add any desired reviewer protection.
2. For `my-pi` and every published `@spences10/pi-*` package,
   configure npm trusted publishing with:
   - provider: GitHub Actions
   - organization or user: `spences10`
   - repository: `my-pi`
   - workflow filename: `publish.yml`
   - environment: `npm`
   - allowed action: `npm publish`
3. Dispatch **Publish packages** from `main` after the version update
   has landed.
4. Confirm each published package exposes an npm provenance
   attestation. After one successful OIDC release, disallow token
   publishing where practical and revoke obsolete long-lived
   automation tokens.

Trusted publishing requires npm CLI 11.5.1 or newer, Node.js 22.14 or
newer, and a GitHub-hosted runner. The workflow uses Node.js 24. If
any package is missing the npm-side trusted-publisher mapping, the
workflow must fail rather than fall back to a repository npm token.

`minimumReleaseAge` and its `pirecall` exception affect dependency
installation freshness, not package publication identity. They are not
a substitute for—or part of—OIDC trusted publishing and provenance.
