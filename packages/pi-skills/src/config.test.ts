import { write_package_settings } from '@spences10/pi-settings';
import { rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
} from 'vite-plus/test';
import {
	is_skill_enabled,
	load_skills_config,
	make_skill_key,
	type SkillsConfig,
} from './config.js';

describe('make_skill_key', () => {
	it('creates key from name and source', () => {
		expect(make_skill_key('my-skill', 'user-local')).toBe(
			'my-skill@user-local',
		);
	});

	it('handles plugin source', () => {
		expect(make_skill_key('audit', 'plugin:impeccable')).toBe(
			'audit@plugin:impeccable',
		);
	});
});

function test_config(
	overrides: Omit<Partial<SkillsConfig>, 'profiles'>,
): SkillsConfig {
	return {
		version: 2,
		enabled: {},
		defaults: 'all-disabled',
		current_profile: 'default',
		profiles: {},
		contexts: [],
		...overrides,
	};
}

describe('load_skills_config', () => {
	let config_home: string;
	let original_agent_dir: string | undefined;

	beforeEach(() => {
		config_home = join(
			tmpdir(),
			`my-pi-skills-config-${Date.now()}-${Math.random()}`,
		);
		original_agent_dir = process.env.PI_CODING_AGENT_DIR;
		process.env.PI_CODING_AGENT_DIR = config_home;
	});

	afterEach(() => {
		if (original_agent_dir === undefined)
			delete process.env.PI_CODING_AGENT_DIR;
		else process.env.PI_CODING_AGENT_DIR = original_agent_dir;
		rmSync(config_home, { recursive: true, force: true });
	});

	it('migrates legacy global enablement into the default profile', () => {
		write_package_settings('skills', {
			version: 1,
			defaults: 'all-enabled',
			enabled: {
				'ui@pi-native': true,
				'legacy-auth@pi-native': false,
			},
			current_profile: 'focused',
			profiles: {
				default: { description: 'Custom default' },
				focused: { extends: ['default'], exclude: ['legacy-*'] },
			},
		});

		const config = load_skills_config();

		expect(config.version).toBe(3);
		expect(config.enabled).toEqual({});
		expect(config.defaults).toBe('all-disabled');
		expect(config.current_profile).toBe('focused');
		expect(config.profiles.default?.include).toEqual(
			expect.arrayContaining(['*', 'ui@pi-native']),
		);
		expect(config.profiles.default?.exclude).toEqual(
			expect.arrayContaining(['legacy-auth@pi-native']),
		);
		expect(config.contexts).toEqual([]);
	});

	it('loads context profile rules', () => {
		write_package_settings('skills', {
			version: 3,
			enabled: {},
			defaults: 'all-disabled',
			current_profile: 'default',
			profiles: {
				default: {},
				cloud: { include: ['cl-*', 'project:*'] },
			},
			contexts: [
				{
					name: 'cloud repos',
					profile: 'cloud',
					when: {
						cwd: '~/repos/cloud-lobsters/*',
						githubOrg: 'cloud-lobsters',
						githubRepo: ['cloud-lobsters/platform'],
					},
				},
			],
		});

		const config = load_skills_config();

		expect(config.contexts).toEqual([
			{
				name: 'cloud repos',
				profile: 'cloud',
				when: {
					cwd: '~/repos/cloud-lobsters/*',
					github_org: 'cloud-lobsters',
					github_repo: ['cloud-lobsters/platform'],
				},
			},
		]);
	});
});

describe('is_skill_enabled', () => {
	it('returns explicit enabled state', () => {
		const config = test_config({
			enabled: { 'my-skill@local': true },
			defaults: 'all-disabled',
		});
		expect(is_skill_enabled(config, 'my-skill@local')).toBe(true);
	});

	it('returns explicit disabled state', () => {
		const config = test_config({
			enabled: { 'my-skill@local': false },
			defaults: 'all-enabled',
		});
		expect(is_skill_enabled(config, 'my-skill@local')).toBe(false);
	});

	it('falls back to all-enabled default', () => {
		const config = test_config({
			enabled: {},
			defaults: 'all-enabled',
		});
		expect(is_skill_enabled(config, 'unknown@source')).toBe(true);
	});

	it('falls back to all-disabled default', () => {
		const config = test_config({
			enabled: {},
			defaults: 'all-disabled',
		});
		expect(is_skill_enabled(config, 'unknown@source')).toBe(false);
	});
});
