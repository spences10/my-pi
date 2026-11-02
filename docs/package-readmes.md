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

## Preview image

The shared README image uses the live splash's logo, with a
configurable outer frame and footer. It is an illustration, not a
capture of a real session. Its version always comes from
`packages/my-pi/package.json`.

Edit the checked-in defaults in
[`assets/pi-package-preview.config.json`](../assets/pi-package-preview.config.json),
then regenerate:

```bash
pnpm run preview:generate
```

The config controls `model`, `project`, `border` (`enabled`, `color`,
`gradient`, `width`, `radius`), and `footer` (`enabled`, `separator`,
`editor`, `color`, `rows`). Footer rows contain `left` and `right`
text. The reference-style layout includes a rounded frame and an
illustrative editor area with a cursor, not a real input field. The
default omits Git changes, cost, context usage, and extension
statuses. Empty model or project labels are hidden from the subtitle.

For a script or one-off image, supply a partial JSON file:

```json
{
	"border": {
		"gradient": ["#9d4dff", "#ff00cc", "#00eaff"],
		"radius": 12
	},
	"footer": {
		"rows": [
			{ "left": "{project}", "right": "{model} · high" },
			{ "left": "Example status", "right": "v{version}" }
		]
	}
}
```

```bash
pnpm run preview:generate --config ./preview.local.json --output /tmp/preview.png
pnpm run preview:generate --no-border --no-footer-editor --footer-left '{project}' --footer-right 'Example status' --output /tmp/minimal.png
pnpm run preview:generate --no-footer --output /tmp/no-footer.png
pnpm run preview:generate --help
```

Precedence is checked-in defaults, then `--config` JSON, then CLI
flags. Nested objects merge by field; a supplied `footer.rows` array
replaces the default rows. `--footer-left` and `--footer-right` update
only the first row and preserve other rows. `--border`/`--no-border`
control the outer frame; the footer divider is controlled separately
with `--footer-separator`/`--no-footer-separator`. The illustrative
editor area is controlled with `--footer-editor`/`--no-footer-editor`.
Set `border.gradient` to 2–8 hex colours, or `null` for a solid frame.
`--border-gradient '#9d4dff,#ff00cc,#00eaff'` sets gradient stops. A
`border.color` or `--border-color` override selects a solid frame
unless an explicit gradient is also supplied. Use `--border-radius` to
adjust the rounded corners. Full CLI options are listed by `--help`.

Footer text substitutes `{version}`, `{model}`, and `{project}`. These
are data-only labels: no commands or JavaScript are executed. Colours
accept `#RGB` or `#RRGGBB`; frame width is 0.5–8 pixels and radius is
0–32 pixels. Up to six footer rows are supported, with single-line
strings of at most 240 characters. Long labels are clipped to the
image width. Unknown fields, invalid values, and unknown CLI flags
fail before writing an image.

Every output PNG gets a `.png.json` freshness record, and rendering
still uses lossless PNG compression. Checks include the resolved
config, version, and image contents. Pass the same overrides when
checking a custom image:

```bash
pnpm run preview:generate --config ./preview.local.json --output /tmp/preview.png --check
```

Use a custom output path for one-off overrides. The normal build and
release checks validate the shared image against the checked-in
defaults, so commit the defaults and both generated files when
changing the repository's image. This configuration does not change
the live splash or `/footer` settings.
