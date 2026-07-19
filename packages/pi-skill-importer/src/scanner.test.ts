import { describe, expect, it } from 'vitest';
import {
	is_importable_skill,
	is_imported_skill,
	type DiscoveredSkill,
} from './scanner.js';

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
