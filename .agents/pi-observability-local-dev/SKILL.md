---
name: pi-observability-local-dev
# prettier-ignore
description: Use when developing or reviewing packages/pi-observability dashboard/server changes locally, especially rebuilding dist, restarting the 43190 server, validating UI behavior, or keeping the local dashboard in sync with source edits.
compatibility:
  Requires the my-pi monorepo and @spences10/pi-observability package.
---

# Pi Observability Local Development

Use this workflow when iterating on `packages/pi-observability` and
the local dashboard at `http://127.0.0.1:43190`.

## Workflow

1. Edit source files under `packages/pi-observability/src`; do not
   edit generated `dist` directly.
2. Validate focused changes first:

   ```bash
   pnpm --filter @spences10/pi-observability run check:self
   pnpm --filter @spences10/pi-observability run test:self
   ```

3. Rebuild the local dashboard/server output:

   ```bash
   pnpm --filter @spences10/pi-observability run build:self
   ```

4. Restart the server bound to port `43190`:

   ```bash
   fuser -v -n tcp 43190
   kill <PID>
   nohup node packages/pi-observability/dist/server.js > /tmp/pi-observability.log 2>&1 &
   tail -n 20 /tmp/pi-observability.log
   ```

5. Refresh `http://127.0.0.1:43190` and review the current UI against
   the requested behavior.

## Notes

- `pnpm --filter ... exec pi-observability-server` may exit quickly in
  this repo; prefer `node packages/pi-observability/dist/server.js`
  for local review.
- If `lsof` is unavailable, use `fuser -v -n tcp 43190` to identify
  the port owner.
- Keep the server PID in the final response when restarting it for the
  user.
- For Svelte edits, run LSP diagnostics and the Svelte autofixer
  before reporting completion.
