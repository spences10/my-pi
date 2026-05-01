import { describe, expect, it } from 'vitest';
import {
	collect_flag_values,
	parse_extension_paths,
	parse_skill_allowlist,
	parse_thinking_level,
	parse_tool_allowlist,
} from './cli-args.js';

describe('CLI arg helpers', () => {
	it('collects repeated flags in spaced and equals forms', () => {
		expect(
			collect_flag_values(
				[
					'node',
					'dist/index.js',
					'--skill=ui',
					'--skill',
					'audit',
					'prompt text',
				],
				['--skill'],
			),
		).toEqual(['ui', 'audit']);
	});

	it('parses extension paths from short and long flags', () => {
		expect(
			parse_extension_paths(
				['my-pi', '-e', './a.ts', '--extension=../b.ts'],
				'/repo/app',
			),
		).toEqual(['/repo/app/a.ts', '/repo/b.ts']);
	});

	it('parses and dedupes comma-separated tool allowlists across repeated flags', () => {
		expect(
			parse_tool_allowlist([
				'my-pi',
				'--tools=bash,read',
				'-t',
				'read,edit',
			]),
		).toEqual(['bash', 'read', 'edit']);
	});

	it('parses repeated and comma-separated skill allowlists', () => {
		expect(
			parse_skill_allowlist([
				'my-pi',
				'--skill=ui,polish',
				'--skill',
				'ui',
			]),
		).toEqual(['ui', 'polish']);
	});

	it('normalizes and validates thinking levels', () => {
		expect(parse_thinking_level('High')).toBe('high');
		expect(parse_thinking_level(undefined)).toBeUndefined();
		expect(() => parse_thinking_level('maximum')).toThrow(
			'--thinking must be one of',
		);
	});
});
