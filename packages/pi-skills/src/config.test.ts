import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
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
		...overrides,
	};
}

describe('load_skills_config', () => {
	let config_home: string;
	let original_xdg: string | undefined;

	beforeEach(() => {
		config_home = join(
			tmpdir(),
			`my-pi-skills-config-${Date.now()}-${Math.random()}`,
		);
		original_xdg = process.env.XDG_CONFIG_HOME;
		process.env.XDG_CONFIG_HOME = config_home;
	});

	afterEach(() => {
		if (original_xdg === undefined)
			delete process.env.XDG_CONFIG_HOME;
		else process.env.XDG_CONFIG_HOME = original_xdg;
		rmSync(config_home, { recursive: true, force: true });
	});

	it('migrates legacy global enablement into the default profile', () => {
		mkdirSync(join(config_home, 'my-pi'), { recursive: true });
		writeFileSync(
			join(config_home, 'my-pi', 'skills.json'),
			JSON.stringify({
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
			}),
		);

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
