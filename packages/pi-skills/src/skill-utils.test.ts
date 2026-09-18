import { describe, expect, it } from 'vite-plus/test';
import type { ManagedSkill, SkillProfile } from './manager.js';
import {
	find_skill,
	format_profile_detail,
	format_skill_list,
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
		scope: 'global',
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
		expect(format_profile_detail(profile)).toContain('ui-*');
	});
});
