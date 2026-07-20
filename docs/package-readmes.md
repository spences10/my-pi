# Package README maintenance

Package READMEs remain the source of truth for package behavior,
configuration, commands, and package-specific installation context.
They are also published to npm, so useful package names, badges, and
install commands stay rendered in each README instead of being
replaced by repository-only links.

Repeated mechanical regions are generated from each package manifest
by
[`tools/sync-package-readmes.ts`](../tools/sync-package-readmes.ts):

- `header` renders the standard badges and package preview; packages
  that do not use Vitest declare `vitest="false"` on the start marker.
- `install` renders the package-specific `pi install npm:` command.
- `development` renders the shared maintenance explanation and the
  commands declared on its start marker.

Marker presence and placement are intentional package-local choices.
Do not move package-specific prerequisites, post-install steps,
runtime behavior, exceptional validation commands, or support-package
guidance into the generator.

After editing a generated region or package name, synchronize and
check the documentation:

```bash
pnpm docs:sync
pnpm docs:check
```

`docs:check` confirms generated regions are current and validates
local Markdown targets and anchors. Relative links in a package README
must stay inside that published package; use an absolute GitHub URL
when linking to repository-level documentation so the link also works
on npm.
