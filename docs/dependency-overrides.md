# Dependency overrides

`pnpm-workspace.yaml` contains repo-wide `overrides` for transitive
dependencies. These are intentionally excluded from normal Renovate
update PRs in `renovate.json` because they are temporary/security
pins, not direct project dependencies.

## Current overrides

| Package                     | Pin      | Why                                                                                                                | Current path                                           | Removal condition                                                                           |
| --------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------ | ------------------------------------------------------------------------------------------- |
| `brace-expansion`           | `5.0.9`  | Fixes current `pnpm audit` denial-of-service advisories for `brace-expansion <5.0.9`.                              | `@earendil-works/pi-coding-agent` → `minimatch`.       | Remove when Pi resolves to a safe version without an override.                              |
| `postcss`                   | `8.5.23` | Fixes current `pnpm audit` PostCSS advisories (`<=8.5.22`).                                                        | Web/dev tooling: `vite`, `vite-plus`, `shadcn-svelte`. | Remove when direct/tooling dependencies resolve to a safe version without an override.      |
| `protobufjs`                | `7.6.5`  | Fixes current `pnpm audit` protobufjs advisories (`<=7.6.4`).                                                      | `@earendil-works/pi-ai` → `@google/genai`.             | Remove when `@google/genai` / Pi dependency resolves to a safe version without an override. |
| `miniflare>ws`              | `8.21.0` | Fixes current `pnpm audit` high severity for `ws >=8.0.0 <8.21.0`. Scoped to avoid changing unrelated `ws` users.  | `apps/web` → `wrangler` / `miniflare`.                 | Remove when Cloudflare tooling resolves to a safe version without an override.              |
| `@changesets/parse>js-yaml` | `4.3.1`  | Fixes the current `pnpm audit` `js-yaml` 4.x denial-of-service advisory.                                           | Changesets parsing tools.                              | Remove when Changesets resolves to a safe version without an override.                      |
| `@sveltejs/kit>cookie`      | `0.7.0`  | Fixes current `pnpm audit` low severity for `cookie <0.7.0`. Scoped to avoid downgrading unrelated `cookie` users. | `apps/web` → `@sveltejs/kit`.                          | Remove when SvelteKit resolves to a safe version without an override.                       |
| `read-yaml-file>js-yaml`    | `3.15.1` | Fixes the current `pnpm audit` `js-yaml` 3.x denial-of-service advisory.                                           | Changesets → `@manypkg/get-packages`.                  | Remove when Changesets resolves to a safe version without an override.                      |

## Audit/removal checklist

For each override, test removal deliberately:

1. Remove one override from `pnpm-workspace.yaml`.
2. Run `pnpm install --lockfile-only`.
3. Run `pnpm audit --audit-level low`.
4. Run the project check/test command if the lockfile changed
   materially.
5. If clean, commit the override removal. If not, keep the pin and
   update this document.
