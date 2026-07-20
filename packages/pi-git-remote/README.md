# @spences10/pi-git-remote

Shared GitHub remote parsing helpers for context-aware Pi packages.
This support package is published for other `@spences10/pi-*` packages
and is not a Pi extension users install directly.

## API

- `parse_github_repo(remote)` normalizes supported GitHub SSH and
  HTTPS remote URLs to a lowercase `owner/repo` identifier.
- `get_github_repos(cwd)` reads the repository's Git remotes, returns
  unique GitHub `owner/repo` identifiers, and returns an empty array
  when Git inspection fails.

Supported remote forms are `git@github.com:owner/repo.git`,
`https://github.com/owner/repo.git`, and
`ssh://git@github.com/owner/repo.git`.

## Development

```bash
pnpm --filter @spences10/pi-git-remote run check
pnpm --filter @spences10/pi-git-remote run test
pnpm --filter @spences10/pi-git-remote run build
```
