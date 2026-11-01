---
title: Package README maintenance
tags: [documentation, packages, generation]
aliases: [README generation]
---

# Package README maintenance

Package READMEs are the user-facing reference for current package
behaviour, configuration, commands, and installation context. They
describe the implementation; executable checks and guardrails enforce
behaviour. They are also published to npm, so useful package names,
badges, and install commands stay rendered in each README instead of
being replaced by repository-only links.

Repeated mechanical regions are generated from each package manifest
by
[`tools/sync-package-readmes.ts`](../tools/sync-package-readmes.ts):

- `header` renders the standard badges and package preview; packages
  that do not use Vitest declare `vitest="false"` on the start marker.
- `install` renders the package-specific `pi install npm:` command.
- `development` renders the shared maintenance explanation and the
  commands declared on its start marker.

The generator covers repeated mechanical text. Package-specific
prerequisites, post-install steps, runtime behaviour, exceptional
validation commands, and support-package guidance remain handwritten
so readers can understand that package without reconstructing the
repository. Existing markers can be adjusted when the package's docs
need to change; they are not a freeze on README structure.

After editing a generated region or package name, synchronize and
check the documentation:

```bash
pnpm docs:sync
pnpm docs:check
```

`docs:check` confirms generated regions are current and validates
local Markdown targets and anchors. Also run `pnpx @wiki0/cli check`
for the changed-doc review described in the
[documentation workflow](./documentation.md). Relative links in a
package README must stay inside that published package; use an
absolute GitHub URL when linking to repository-level documentation so
the link also works on npm.
