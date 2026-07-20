import {
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
	is_importable_skill,
	is_imported_skill,
	scan_project_skills,
	type DiscoveredSkill,
} from './scanner.js';

const temp_dirs: string[] = [];

function make_project(): string {
	const root = mkdtempSync(join(tmpdir(), 'pi-importer-project-'));
	temp_dirs.push(root);
	mkdirSync(join(root, '.git'));
	return root;
}

function write_skill(path: string): void {
	mkdirSync(dirname(path), { recursive: true });
	writeFileSync(
		path,
		'---\ndescription: Scanner fixture\n---\n\n# Fixture\n',
	);
}

afterEach(() => {
	for (const dir of temp_dirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

const base_skill: DiscoveredSkill = {
	name: 'example',
	description: 'Example skill',
	skillPath: '/skills/example/SKILL.md',
	baseDir: '/skills/example',
	source: 'pi-native',
	scope: 'global',
	kind: 'managed',
};

describe('packages/pi-skill-importer/src/scanner.ts', () => {
	it('loads without side effects', async () => {
		await expect(import('./scanner.js')).resolves.toBeDefined();
	});

	it('narrows importable plugin skills for public API consumers', () => {
		const importable: DiscoveredSkill = {
			...base_skill,
			source: 'plugin:owner/plugin',
			scope: 'plugin',
			kind: 'external',
			plugin: {
				pluginId: 'owner/plugin',
				installPath: '/plugins/owner/plugin',
				version: '1.0.0',
			},
		};

		expect(is_importable_skill(importable)).toBe(true);
		expect(is_importable_skill(base_skill)).toBe(false);
	});

	it('preserves project sources, root Markdown skills, and deduplication', () => {
		const root = make_project();
		write_skill(join(root, '.agents', 'general', 'SKILL.md'));
		write_skill(
			join(root, '.agents', 'skills', 'shared', 'SKILL.md'),
		);
		write_skill(join(root, '.pi', 'skills', 'standalone.md'));

		expect(
			scan_project_skills(root).map(
				({ name, source, scope, skillPath }) => ({
					name,
					source,
					scope,
					skillPath,
				}),
			),
		).toEqual([
			{
				name: 'general',
				source: 'project:.agents',
				scope: 'project',
				skillPath: join(root, '.agents', 'general', 'SKILL.md'),
			},
			{
				name: 'shared',
				source: 'project:.agents/skills',
				scope: 'project',
				skillPath: join(
					root,
					'.agents',
					'skills',
					'shared',
					'SKILL.md',
				),
			},
			{
				name: 'standalone',
				source: 'project:.pi/skills',
				scope: 'project',
				skillPath: join(root, '.pi', 'skills', 'standalone.md'),
			},
		]);
	});

	it('narrows managed copies with importer provenance', () => {
		const imported: DiscoveredSkill = {
			...base_skill,
			import_meta: {
				version: 1,
				source: 'plugin:owner/plugin',
				upstream_skill_path:
					'/plugins/owner/plugin/skills/example/SKILL.md',
				upstream_base_dir: '/plugins/owner/plugin/skills/example',
				imported_at: '2026-07-19T00:00:00.000Z',
				last_synced_at: '2026-07-19T00:00:00.000Z',
				imported_hash: 'local-hash',
				upstream_hash: 'upstream-hash',
			},
		};

		expect(is_imported_skill(imported)).toBe(true);
		expect(is_imported_skill(base_skill)).toBe(false);
	});
});
