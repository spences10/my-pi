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

- discovers Pi-native skills in `~/.pi/agent/skills`
- discovers user-local Claude skills in `~/.claude/skills`
- discovers skills bundled inside installed Claude plugins
- imports plugin skills into Pi-native skill storage
- syncs imported skills when upstream plugin content changes
- provides a `/skills` command and interactive picker

Imported skills are copied into:

```text
~/.pi/agent/skills/<skill-name>
```

Import metadata is stored beside each imported skill so sync can
detect local edits and upstream changes.

## Commands

```text
/skills
/skills import <key-or-name>
/skills sync <key-or-name>
/skills refresh
/skills defaults all-enabled
/skills defaults all-disabled
```

With a UI available, `/skills` opens an interactive manager. In
headless mode, use the subcommands directly.

## Skill enablement

The extension tracks enabled/disabled state in its own config and
contributes enabled managed skill paths during Pi resource discovery.

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
