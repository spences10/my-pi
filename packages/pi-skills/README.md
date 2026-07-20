# @spences10/pi-skills

<!-- package-readme:header:start -->

[![built with Vite+](https://img.shields.io/badge/built%20with-Vite+-646CFF?logo=vite&logoColor=white)](https://viteplus.dev)
[![tested with Vitest](https://img.shields.io/badge/tested%20with-Vitest-6E9F18?logo=vitest&logoColor=white)](https://vitest.dev)
[![npm version](https://img.shields.io/npm/v/@spences10/pi-skills?color=CB3837&logo=npm&logoColor=white)](https://www.npmjs.com/package/@spences10/pi-skills)
[![license](https://img.shields.io/npm/l/@spences10/pi-skills)](https://www.npmjs.com/package/@spences10/pi-skills)

![my-pi package preview](https://raw.githubusercontent.com/spences10/my-pi/main/assets/pi-package-preview.png)

<!-- package-readme:header:end -->

Manage the skills Pi is allowed to discover and use. `pi-skills` adds
profiles, enable/disable rules, GitHub skill search/install, and
update flows so teams can curate reusable Agent Skills instead of
hand-editing skill directories.

## Installation

<!-- package-readme:install:start -->

```bash
pi install npm:@spences10/pi-skills
```

<!-- package-readme:install:end -->

Local development from this monorepo:

```bash
pnpm --filter @spences10/pi-skills run build
pi install ./packages/pi-skills
# or for one run only
pi -e ./packages/pi-skills
```

## Relationship to upstream Pi

Audit baseline: upstream Pi
[`0.80.10`](https://github.com/earendil-works/pi/tree/13437ca828894f43f973c630d208b488637d8fa9/packages/coding-agent)
already implements the Agent Skills runtime, including parsing and
validation, prompt exposure, `/skill:name`, trusted project discovery,
package-managed skills, settings and CLI paths, and per-resource
selection through `pi config`. Its SDK also exposes skill loading,
`resources_discover`, and `skillsOverride`. This package does not
replace those primitives.

| Capability                                                                                                      | Classification     | Boundary and remaining value                                                                               |
| --------------------------------------------------------------------------------------------------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------- |
| Agent Skills parsing, validation, prompt exposure, and `/skill:name`                                            | Upstream primitive | Pi owns skill semantics and execution.                                                                     |
| Global, trusted project, package, settings, and CLI skill discovery                                             | Upstream primitive | Prefer Pi's documented locations and package manifest support.                                             |
| Static per-resource enable/disable through `pi config`                                                          | Upstream primitive | Use native configuration when profiles and context switching are unnecessary.                              |
| Scanning native skill metadata and contributing selected paths through `resources_discover` or `skillsOverride` | Wrapper            | Supplies the package UI and profile decisions while Pi remains the loader.                                 |
| GitHub search, preview, install, and update                                                                     | Wrapper            | Delegates source tracking and updates to the preview `gh skill` commands; this is not a Pi SDK feature.    |
| Named profiles, inherited pattern rules, and `cwd`/GitHub context selection                                     | Additive feature   | Provides reusable skill sets and automatic project-aware activation beyond native static filters.          |
| Consolidated management UI and importer composition                                                             | Additive feature   | Combines profile operations, GitHub lifecycle actions, and provenance-aware external imports in `/skills`. |
| Discovery of `SKILL.md` below `.agents/**` outside `.agents/skills/`                                            | Removal candidate  | Retained for compatibility; new skills should use Pi's native `.agents/skills/` layout.                    |

See upstream's
[Skills](https://github.com/earendil-works/pi/blob/13437ca828894f43f973c630d208b488637d8fa9/packages/coding-agent/docs/skills.md),
[Pi Packages](https://github.com/earendil-works/pi/blob/13437ca828894f43f973c630d208b488637d8fa9/packages/coding-agent/docs/packages.md),
and
[extension resource events](https://github.com/earendil-works/pi/blob/13437ca828894f43f973c630d208b488637d8fa9/packages/coding-agent/docs/extensions.md#resources_discover)
for the native behavior this package composes.

## What it does

This package adds a management layer around Pi's native skill runtime:

- discovers Pi-native skills in `$PI_CODING_AGENT_DIR/skills`
  (default: `~/.pi/agent/skills`)
- discovers project skills recursively in `.agents/**/SKILL.md`,
  `.agents/skills/**/SKILL.md`, `.pi/skills/**/SKILL.md`, and root
  `.pi/skills/*.md` files
- searches public GitHub `SKILL.md` files through `gh skill search`
- previews GitHub-hosted skills through `gh skill preview`
- installs GitHub-hosted skills through `gh skill` when GitHub CLI
  support is available
- checks or applies GitHub skill updates through `gh skill update`
- provides a task-oriented `/skills` command with **Installed**,
  **Available**, **Add / import**, and **Advanced** sections
- discovers new skills in repositories represented by existing
  `gh skill` installs; preview and explicit confirmation are required
  before installation
- composes the public `@spences10/pi-skill-importer` API for external
  plugin import, provenance, sync/rebind, and metadata-owned deletion

## Commands

```text
/skills
/skills enable <key|name|pattern>
/skills disable <key|name|pattern>
/skills search <query>
/skills add <owner/repo> <skill[@ref]> [--pin ref|--scope project|--dir path|--force]
/skills update --dry-run
/skills update --all
/skills profile create <name>
/skills profile use <name>
/skills refresh
/skills defaults all-enabled
/skills defaults all-disabled
```

GitHub search, installs, and updates require GitHub CLI `gh` v2.90.0
or newer with preview `gh skill` support. The extension delegates
GitHub source tracking, pinning, preview/update metadata, and tree-SHA
comparison to `gh skill` instead of maintaining a parallel cache.

With a UI available, `/skills` opens four task-oriented sections:

- **Installed** — search and enable/disable skills, inspect details,
  or choose a separately confirmed delete
- **Available** — reconcile installed `gh skill` inventory with known
  repository trees, preview newly published skills, and dry-run
  updates
- **Add / import** — add from GitHub or review/import/sync/delete
  compatible external plugin skills
- **Advanced** — profiles, default policy, manual refresh, and
  diagnostic browsing

GitHub installation follows
`preview → explicit confirmation → install → Pi reload`; discovery
never auto-installs or activates an upstream skill. Importer
sync/rebind continues to refuse overwriting local changes, and
importer deletion only removes metadata-owned copies. Existing
subcommands remain available for headless and scripted use.

## Skill enablement

The extension treats profiles as named skill sets. The active profile
contains include/exclude rules for skill names, keys, sources, or
paths; `*` wildcards are supported. Legacy top-level enablement is
migrated into the `default` profile on load.

The extension contributes enabled managed skill paths during Pi
resource discovery. Project skills are enabled by default when project
resources are allowed, and can still be excluded by profile rules.

Profiles can also be selected by context without hardcoding project
names in code. Contexts support `cwd`, `github_org`, and `github_repo`
predicates; matching any configured predicate activates the profile.
Camel-case `githubOrg` and `githubRepo` are accepted on load and
normalized to snake case. Example:

```json
{
	"contexts": [
		{
			"name": "client-workspace",
			"profile": "client-projects",
			"when": {
				"cwd": "~/repos/client-projects/*",
				"github_org": "client-org",
				"github_repo": ["client-org/app"]
			}
		}
	],
	"profiles": {
		"default": { "include": [], "exclude": [] },
		"client-projects": {
			"extends": ["default"],
			"include": ["client-*", "project:*"],
			"exclude": []
		}
	}
}
```

In a custom harness such as `my-pi`, this can be combined with a
resource filter to enforce disabled skills. In vanilla `pi`, Pi's own
default skill discovery can still load skills from default locations,
so use `pi config` or settings filters when you need hard disable
semantics.

## Using from a custom harness

```ts
import skills, { create_skills_manager } from '@spences10/pi-skills';

// pass `skills` as an ExtensionFactory to your Pi runtime
const manager = create_skills_manager();
```

`my-pi` imports this package directly and uses
`create_skills_manager()` to enforce its built-in skill toggle
behavior.

## Development

<!-- package-readme:development:start commands="check,test,build" -->

Package scripts build transitive workspace dependencies first, then
run local tools through Vite+ with `vp exec`.

```bash
pnpm --filter @spences10/pi-skills run check
pnpm --filter @spences10/pi-skills run test
pnpm --filter @spences10/pi-skills run build
```

<!-- package-readme:development:end -->

## License

MIT
