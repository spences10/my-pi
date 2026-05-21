# @spences10/pi-skill-importer

[![built with Vite+](https://img.shields.io/badge/built%20with-Vite+-646CFF?logo=vite&logoColor=white)](https://viteplus.dev)
[![tested with Vitest](https://img.shields.io/badge/tested%20with-Vitest-6E9F18?logo=vitest&logoColor=white)](https://vitest.dev)
[![npm version](https://img.shields.io/npm/v/@spences10/pi-skill-importer?color=CB3837&logo=npm&logoColor=white)](https://www.npmjs.com/package/@spences10/pi-skill-importer)
[![license](https://img.shields.io/npm/l/@spences10/pi-skill-importer)](https://www.npmjs.com/package/@spences10/pi-skill-importer)

![my-pi package preview](https://raw.githubusercontent.com/spences10/my-pi/main/assets/pi-package-preview.png)

Move external Agent Skills into Pi without hand-copying files.
`pi-skill-importer` provides the import helpers Pi uses to normalize
skill metadata, content, and storage from compatible skill sources.

The extension registers `/skill-importer` with list/import/sync/delete
flows. It discovers Claude plugin skills, then copies selected skills
into:

```text
$PI_CODING_AGENT_DIR/skills/<skill-name>
```

Imported copies include provenance metadata so sync can detect
upstream changes and refuse to overwrite local edits.

## Safety model

External source locations such as `~/.claude/skills` and Claude plugin
caches are treated as upstream sources. The importer only owns copied
Pi-native skills that contain its metadata; it should not delete
upstream Claude/plugin directories.

## Commands

```text
/skill-importer
/skill-importer list
/skill-importer import <key|name>
/skill-importer sync <key|name>
/skill-importer delete <key|name>
```

Review external skills before importing: they can instruct agent
behavior and tool use. Sync refuses to overwrite local edits, and
delete only removes imported Pi-native copies with metadata.

## API

```ts
import {
	scan_importable_skills,
	import_external_skill,
	sync_imported_skill,
	delete_imported_skill,
} from '@spences10/pi-skill-importer';
```

## Development

Package scripts build transitive workspace dependencies first, then
run local tools through Vite+ with `vp exec`.

```bash
pnpm --filter @spences10/pi-skill-importer run check
pnpm --filter @spences10/pi-skill-importer run test
```

## License

MIT
