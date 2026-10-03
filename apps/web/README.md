# my-pi landing page

SvelteKit 3 site for discovering my-pi and its packages. It uses the
Cloudflare adapter and deploys as the `my-pi` Worker configured in
[`wrangler.jsonc`](./wrangler.jsonc).

## Local development

Run commands from the repository root:

```bash
pnpm install
pnpm --dir apps/web dev
```

Validate and build the site with:

```bash
pnpm --dir apps/web check
pnpm --dir apps/web build
```

SvelteKit configuration lives in `vite.config.ts`. Library imports use
`#lib/*` subpath imports declared in `package.json`, and
`tsconfig.json` extends `$app/tsconfig`.

Checks run TypeScript 7 through `@typescript/native` and
`svelte-check --tsgo`. The `typescript` dependency stays on the
`typescript6` catalog for the JavaScript compiler API still required
by SvelteKit's type generation and `svelte-check`.

Preview the Cloudflare Worker output locally after building:

```bash
pnpm --dir apps/web preview
```

## Deployment

Deployment is manual; `.github/workflows/web.yml` checks and builds
web changes but does not publish them. Authenticate Wrangler with the
Cloudflare account that owns the Worker, then build and deploy:

```bash
pnpm --dir apps/web build
pnpm --dir apps/web exec wrangler deploy
```

Wrangler reads `apps/web/wrangler.jsonc` and uploads the generated
`.svelte-kit/cloudflare/_worker.js` entrypoint and static assets. The
configuration enables a `workers.dev` URL and preview URLs. Production
routes or custom domains are managed in Cloudflare and are not
declared in this repository.
