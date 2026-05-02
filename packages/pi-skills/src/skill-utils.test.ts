import { describe, expect, it } from 'vitest';
import type { ManagedSkill, SkillProfile } from './manager.js';
import {
	find_skill,
	format_profile_detail,
	format_skill_list,
	get_importable_state,
	profile_description,
	sort_skills,
} from './skill-utils.js';

function skill(overrides: Partial<ManagedSkill>): ManagedSkill {
	return {
		name: 'research',
		description: 'Research things',
		skillPath: '/skills/research/SKILL.md',
		baseDir: '/skills/research',
		source: 'pi-native',
		kind: 'managed',
		key: 'research@pi-native',
		enabled: true,
		...overrides,
	};
}

describe('skill utilities', () => {
	it('sorts skills by name, source, then key', () => {
		expect(
			sort_skills([
				skill({ name: 'zeta', key: 'zeta@pi-native' }),
				skill({
					name: 'alpha',
					source: 'user-local',
					key: 'alpha@user-local',
				}),
				skill({
					name: 'alpha',
					source: 'pi-native',
					key: 'alpha@pi-native',
				}),
			]).map((s) => s.key),
		).toEqual([
			'alpha@pi-native',
			'alpha@user-local',
			'zeta@pi-native',
		]);
	});

	it('finds a skill by key or unique name', () => {
		const skills = [
			skill({ name: 'research', key: 'research@pi-native' }),
			skill({ name: 'audit', key: 'audit@pi-native' }),
		];

		expect(find_skill(skills, 'audit').key).toBe('audit@pi-native');
		expect(find_skill(skills, 'research@pi-native').name).toBe(
			'research',
		);
	});

	it('formats skill and profile summaries', () => {
		expect(format_skill_list([skill({ enabled: false })])).toContain(
			'disabled',
		);

		const profile: SkillProfile = {
			name: 'frontend',
			description: 'Frontend project skills.',
			extends: ['default'],
			include: ['ui-*'],
			exclude: [],
			active: true,
		};

		expect(profile_description(profile)).toBe(
			'active • extends default • 1 include • 0 exclude',
		);
		expect(format_profile_detail(profile)).toContain('- ui-*');
	});

	it('marks importable skills as syncable when upstream changed', () => {
		const external = skill({
			name: 'frontend-design',
			source: 'plugin:design',
			key: 'frontend-design@plugin:design',
			kind: 'external',
			plugin: {
				pluginId: 'design',
				installPath: '/plugin',
				version: '2.0.0',
			},
		});
		const imported = skill({
			name: 'frontend-design',
			key: 'frontend-design@pi-native',
			import_meta: {
				version: 1,
				source: 'plugin:design',
				upstream_skill_path: external.skillPath,
				upstream_base_dir: external.baseDir,
				upstream_version: '1.0.0',
				imported_at: '2026-01-01T00:00:00.000Z',
				last_synced_at: '2026-01-01T00:00:00.000Z',
				imported_hash: 'a',
				upstream_hash: 'a',
			},
		});

		expect(get_importable_state([imported], external).action).toBe(
			'sync',
		);
	});
});
