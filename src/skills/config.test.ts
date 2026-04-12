import { afterEach, describe, expect, it } from 'vitest';
import {
	is_skill_enabled,
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
		expect(
			make_skill_key('audit', 'plugin:impeccable'),
		).toBe('audit@plugin:impeccable');
	});
});

describe('is_skill_enabled', () => {
	it('returns explicit enabled state', () => {
		const config: SkillsConfig = {
			version: 1,
			enabled: { 'my-skill@local': true },
			defaults: 'all-disabled',
		};
		expect(
			is_skill_enabled(config, 'my-skill@local'),
		).toBe(true);
	});

	it('returns explicit disabled state', () => {
		const config: SkillsConfig = {
			version: 1,
			enabled: { 'my-skill@local': false },
			defaults: 'all-enabled',
		};
		expect(
			is_skill_enabled(config, 'my-skill@local'),
		).toBe(false);
	});

	it('falls back to all-enabled default', () => {
		const config: SkillsConfig = {
			version: 1,
			enabled: {},
			defaults: 'all-enabled',
		};
		expect(
			is_skill_enabled(config, 'unknown@source'),
		).toBe(true);
	});

	it('falls back to all-disabled default', () => {
		const config: SkillsConfig = {
			version: 1,
			enabled: {},
			defaults: 'all-disabled',
		};
		expect(
			is_skill_enabled(config, 'unknown@source'),
		).toBe(false);
	});
});
