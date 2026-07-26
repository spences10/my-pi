# @spences10/pi-skill-importer

<!-- package-readme:header:start -->

[![built with Vite+](https://img.shields.io/badge/built%20with-Vite+-646CFF?logo=vite&logoColor=white)](https://viteplus.dev)
[![tested with Vitest](https://img.shields.io/badge/tested%20with-Vitest-6E9F18?logo=vitest&logoColor=white)](https://vitest.dev)
[![npm version](https://img.shields.io/npm/v/@spences10/pi-skill-importer?color=CB3837&logo=npm&logoColor=white)](https://www.npmjs.com/package/@spences10/pi-skill-importer)
[![license](https://img.shields.io/npm/l/@spences10/pi-skill-importer)](https://www.npmjs.com/package/@spences10/pi-skill-importer)

![my-pi package preview](https://raw.githubusercontent.com/spences10/my-pi/main/assets/pi-package-preview.png)

<!-- package-readme:header:end -->

Move external Agent Skills into Pi without hand-copying files.
`pi-skill-importer` provides provenance-aware helpers for copying and
maintaining skills from compatible external sources.

## Relationship to upstream Pi

Audit baseline: upstream Pi
[`0.82.0`](https://github.com/earendil-works/pi/tree/083e61621276bff9f6faefab87ce07fcd98734e2/packages/coding-agent)
can load other harnesses' skill directories directly through the
`skills` settings array or `--skill`; copying is not required merely
to make those skills available. Pi also owns Agent Skills parsing,
validation, discovery, and native storage loading. This package is for
users who intentionally want independently managed Pi-native copies.

| Capability                                                                         | Classification     | Boundary and remaining value                                                                                                 |
| ---------------------------------------------------------------------------------- | ------------------ | ---------------------------------------------------------------------------------------------------------------------------- |
| Loading external skill files or directories through settings or `--skill`          | Upstream primitive | Point Pi at `~/.claude/skills` or another compatible directory when a copied snapshot is unnecessary.                        |
| Loading copied skills from `$PI_CODING_AGENT_DIR/skills`                           | Wrapper            | The importer writes into Pi's native skill location; Pi performs discovery and execution.                                    |
| Claude installed-plugin cache discovery                                            | Additive feature   | Finds skills and plugin version/commit context that Pi does not import or track.                                             |
| Provenance metadata, content hashes, safe sync/rebind, and metadata-owned deletion | Additive feature   | Tracks copied snapshots, refuses to overwrite local edits, recovers moved plugin caches, and never deletes upstream sources. |
| Public import/sync/delete API and consolidated `/skills` integration               | Additive feature   | Supports custom management flows and the preferred `pi-skills` UI.                                                           |
| Copying solely to make an external directory loadable                              | Removal candidate  | Use Pi's native `skills` setting instead; import only when copy ownership and provenance are required.                       |
| Standalone `/skill-importer` command                                               | Removal candidate  | Kept as a deprecated compatibility surface while `/skills` is the preferred UI.                                              |

See upstream's
[Skills](https://github.com/earendil-works/pi/blob/13437ca828894f43f973c630d208b488637d8fa9/packages/coding-agent/docs/skills.md)
and
[settings](https://github.com/earendil-works/pi/blob/13437ca828894f43f973c630d208b488637d8fa9/packages/coding-agent/docs/settings.md#resources)
for the native no-copy path.

The public API powers the consolidated `/skills` → **Add / import**
experience. The extension still registers `/skill-importer` with
list/import/sync/delete flows as a deprecated compatibility surface;
existing scripts and commands continue to work. It discovers Claude
plugin skills, then copies selected skills into:

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
/skills                 # preferred interactive entry point
/skill-importer          # deprecated compatibility UI
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

The package also exports `scan_skill_directory`,
`dedupe_skills_by_path`, and `find_project_roots` for packages that
need scanner-compatible discovery without duplicating filesystem
behavior.

## Development

<!-- package-readme:development:start commands="check,test" -->

Package scripts build transitive workspace dependencies first, then
run local tools through Vite+ with `vp exec`.

```bash
pnpm --filter @spences10/pi-skill-importer run check
pnpm --filter @spences10/pi-skill-importer run test
```

<!-- package-readme:development:end -->

## License

MIT
