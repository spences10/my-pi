# @spences10/pi-skills

[![npm version](https://img.shields.io/npm/v/@spences10/pi-skills?color=CB3837&logo=npm)](https://www.npmjs.com/package/@spences10/pi-skills)
[![built with Vite+](https://img.shields.io/badge/built%20with-Vite+-646CFF?logo=vite&logoColor=white)](https://viteplus.dev)
[![tested with Vitest](https://img.shields.io/badge/tested%20with-Vitest-6E9F18?logo=vitest&logoColor=white)](https://vitest.dev)

Pi extension for managing and importing Agent Skills from Pi, Claude,
and plugin sources.

Maintained in the `my-pi` Vite+ workspace and tested with Vitest.

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
layer for mixed skill ecosystems:

- discovers Pi-native skills in `$PI_CODING_AGENT_DIR/skills`
  (default: `~/.pi/agent/skills`)
- discovers user-local Claude skills in `~/.claude/skills`
- discovers skills bundled inside installed Claude plugins
- imports plugin skills into Pi-native skill storage
- syncs imported skills when upstream plugin content changes
- provides a `/skills` command and interactive picker

Imported skills are copied into:

```text
$PI_CODING_AGENT_DIR/skills/<skill-name>
```

The `~/.claude` locations are intentional upstream discovery sources,
not Pi-managed state. Use `--no-skills` or `--untrusted` when sandbox
runs must not read user-local Claude skills/plugins.

Import metadata is stored beside each imported skill so sync can
detect local edits and upstream changes.

## Commands

```text
/skills
/skills enable <key|name|pattern>
/skills disable <key|name|pattern>
/skills import <key-or-name>
/skills sync <key-or-name>
/skills profile create <name>
/skills profile use <name>
/skills refresh
/skills defaults all-enabled
/skills defaults all-disabled
```

With a UI available, `/skills` opens a modal home menu for managing,
importing, syncing, refreshing, profile switching, and profile
baseline selection. The no-arg `import`, `sync`, and `defaults`
subcommands use modal pickers/forms in interactive mode. In headless
mode, use the subcommands directly.

## Skill enablement

The extension treats profiles as named skill sets. The active profile
contains include/exclude rules for skill names, keys, sources, or
paths; `*` wildcards are supported. Legacy top-level enablement is
migrated into the `default` profile on load.

The extension contributes enabled managed skill paths during Pi
resource discovery.

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

```bash
pnpm --filter @spences10/pi-skills run check
pnpm --filter @spences10/pi-skills run test
pnpm --filter @spences10/pi-skills run build
```

## License

MIT
