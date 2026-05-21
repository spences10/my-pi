# @spences10/pi-skills

[![built with Vite+](https://img.shields.io/badge/built%20with-Vite+-646CFF?logo=vite&logoColor=white)](https://viteplus.dev)
[![tested with Vitest](https://img.shields.io/badge/tested%20with-Vitest-6E9F18?logo=vitest&logoColor=white)](https://vitest.dev)
[![npm version](https://img.shields.io/npm/v/@spences10/pi-skills?color=CB3837&logo=npm&logoColor=white)](https://www.npmjs.com/package/@spences10/pi-skills)
[![license](https://img.shields.io/npm/l/@spences10/pi-skills)](https://www.npmjs.com/package/@spences10/pi-skills)

![my-pi package preview](https://raw.githubusercontent.com/spences10/my-pi/main/assets/pi-package-preview.png)

Manage the skills Pi is allowed to discover and use. `pi-skills` adds
profiles, enable/disable rules, GitHub skill search/install, and
update flows so teams can curate reusable Agent Skills instead of
hand-editing skill directories.

## Installation

```bash
pi install npm:@spences10/pi-skills
```

Local development from this monorepo:

```bash
pnpm --filter @spences10/pi-skills run build
pi install ./packages/pi-skills
# or for one run only
pi -e ./packages/pi-skills
```

## What it does

Pi already has native skill discovery. This package adds a management
layer for Pi skill ecosystems:

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
- provides a `/skills` command and interactive picker

External source import/sync behavior lives in
`@spences10/pi-skill-importer`.

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

With a UI available, `/skills` opens a modal home menu for managing,
adding GitHub skills, updating GitHub skills, refreshing discovery,
profile switching, and profile baseline selection. The Add GitHub
skill flow can install one skill or every `SKILL.md` found in a
repository. The no-arg `search`, `add`, and `defaults` subcommands use
modal pickers/forms in interactive mode. In headless mode, use the
subcommands directly.

## Skill enablement

The extension treats profiles as named skill sets. The active profile
contains include/exclude rules for skill names, keys, sources, or
paths; `*` wildcards are supported. Legacy top-level enablement is
migrated into the `default` profile on load.

The extension contributes enabled managed skill paths during Pi
resource discovery. Project skills are enabled by default when project
resources are allowed, and can still be excluded by profile rules.

Profiles can also be selected by context without hardcoding project
names in code. Example:

```json
{
	"contexts": [
		{
			"name": "client-workspace",
			"profile": "client-projects",
			"when": { "cwd": "~/repos/client-projects/*" }
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

Package scripts build transitive workspace dependencies first, then
run local tools through Vite+ with `vp exec`.

```bash
pnpm --filter @spences10/pi-skills run check
pnpm --filter @spences10/pi-skills run test
pnpm --filter @spences10/pi-skills run build
```

## License

MIT
