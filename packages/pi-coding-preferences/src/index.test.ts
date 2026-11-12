import { read_settings_section } from '@spences10/pi-settings';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vite-plus/test';
import {
	default_config,
	find_coding_preference_violation,
	format_coding_preference_violation,
	get_project_config_path,
	load_config,
	should_block_coding_preference,
	type CodingPreferencesConfig,
} from './index.js';

vi.mock(
	import('@spences10/pi-settings'),
	async (import_original) => ({
		...(await import_original()),
		read_settings_section: vi.fn(),
	}),
);

vi.mock('@earendil-works/pi-coding-agent', () => ({
	getAgentDir: () =>
		join(tmpdir(), 'pi-coding-preferences-test-agent'),
}));

function event(toolName: string, input: Record<string, unknown>) {
	return {
		type: 'tool_call',
		toolName,
		toolCallId: 'test',
		input,
	} as Parameters<typeof should_block_coding_preference>[0];
}

function write_project_config(
	dir: string,
	config: Partial<CodingPreferencesConfig>,
) {
	const pi_dir = join(dir, '.pi');
	mkdirSync(pi_dir, { recursive: true });
	writeFileSync(
		join(pi_dir, 'coding-preferences.json'),
		JSON.stringify(config),
	);
}

describe('coding preferences', () => {
	beforeEach(() => {
		vi.resetAllMocks();
	});

	it('blocks defaults from JSON-style rules', () => {
		expect(
			should_block_coding_preference(
				event('read', { path: '.env' }),
				default_config,
			),
		).toContain('secret files');
		expect(
			should_block_coding_preference(
				event('bash', { command: 'cat package.json' }),
				default_config,
			),
		).toContain('read tool');
		expect(
			should_block_coding_preference(
				event('bash', { command: 'grep -R TODO src' }),
				default_config,
			),
		).toContain('use rg');
		expect(
			should_block_coding_preference(
				event('write', { path: 'TODO.md', content: '- item' }),
				default_config,
			),
		).toContain('ad-hoc TODO');
	});

	it('supports user-defined config rules', () => {
		const config: CodingPreferencesConfig = {
			rules: [
				{
					name: 'no-npm',
					toolNames: ['bash'],
					target: 'command',
					pattern: '^npm\\b',
					reason: 'Use pnpm in this repo.',
				},
			],
		};

		expect(
			should_block_coding_preference(
				event('bash', { command: 'npm install' }),
				config,
			),
		).toBe('Use pnpm in this repo.');
		expect(
			should_block_coding_preference(
				event('bash', { command: 'pnpm install' }),
				config,
			),
		).toBeUndefined();
	});

	it('reports the matching rule and nested input field without the match', () => {
		const config: CodingPreferencesConfig = {
			rules: [
				{
					name: 'restricted-content',
					toolNames: ['edit'],
					target: 'input',
					pattern: 'forbidden',
					reason: 'Do not add restricted content.',
				},
			],
		};

		const violation = find_coding_preference_violation(
			event('edit', {
				path: 'src/example.ts',
				edits: [
					{
						oldText: 'const value = 1;',
						newText: "throw new Error('forbidden value');",
					},
				],
			}),
			config,
		);

		expect(violation).toEqual({
			field: 'input.edits[0].newText',
			reason: 'Do not add restricted content.',
			rule_name: 'restricted-content',
		});
		expect(format_coding_preference_violation(violation!)).toBe(
			'Do not add restricted content. [rule: restricted-content; field: input.edits[0].newText]',
		);
	});

	it.each([
		[
			'write',
			{ path: 'forbidden.ts', content: 'forbidden' },
			'input.content',
		],
		[
			'edit',
			{ path: 'file.ts', oldText: 'safe', newText: 'forbidden' },
			'input.newText',
		],
		[
			'edit',
			{
				path: 'file.ts',
				edits: [
					{ oldText: 'one', newText: 'safe' },
					{ oldText: 'two', newText: 'forbidden' },
				],
			},
			'input.edits[1].newText',
		],
	] as const)(
		'checks proposed content for %s',
		(tool_name, input, field) => {
			const config: CodingPreferencesConfig = {
				rules: [
					{
						name: 'restricted-content',
						target: 'content',
						pattern: 'forbidden',
						reason: 'Restricted content.',
					},
				],
			};

			expect(
				find_coding_preference_violation(
					event(tool_name, input),
					config,
				)?.field,
			).toBe(field);
		},
	);

	it('allows removing violations without changing whole-input rules', () => {
		const rule = {
			name: 'restricted-content',
			pattern: 'forbidden',
			reason: 'Restricted content.',
		};

		const correction = event('edit', {
			path: 'forbidden.ts',
			edits: [{ oldText: 'forbidden', newText: 'safe' }],
		});

		expect(
			should_block_coding_preference(correction, {
				rules: [{ ...rule, target: 'content' }],
			}),
		).toBeUndefined();
		expect(
			find_coding_preference_violation(correction, {
				rules: [{ ...rule, target: 'input' }],
			})?.field,
		).toBe('input.path');
		expect(
			find_coding_preference_violation(
				event('edit', {
					path: 'safe.ts',
					edits: [{ oldText: 'forbidden', newText: 'safe' }],
				}),
				{ rules: [{ ...rule, target: 'input' }] },
			)?.field,
		).toBe('input.edits[0].oldText');
	});

	it('does not apply content rules to commands or unrelated input fields', () => {
		const config: CodingPreferencesConfig = {
			rules: [
				{
					name: 'restricted-content',
					target: 'content',
					pattern: 'forbidden',
					reason: 'Restricted content.',
				},
			],
		};

		for (const call of [
			event('bash', { command: 'forbidden', content: 'forbidden' }),
			event('write', {
				path: 'forbidden',
				content: 'safe',
				description: 'forbidden',
			}),
			event('edit', {
				path: 'forbidden',
				oldText: 'forbidden',
				newText: 'safe',
			}),
		])
			expect(
				should_block_coding_preference(call, config),
			).toBeUndefined();
	});

	it('keeps syntax-aware naming separate from workflow text rules', () => {
		for (const content of [
			"throw new Error('--type must be user, assistant, toolResult, or all');",
			"test('type combines with project and session', () => {});",
			"import { runCommand } from 'citty';",
			'const badName = 1;',
		]) {
			expect(
				should_block_coding_preference(
					event('write', {
						path: 'example.ts',
						content,
					}),
					default_config,
				),
			).toBeUndefined();
		}
	});

	it('preserves configured reasons for compatibility', () => {
		const config: CodingPreferencesConfig = {
			rules: [
				{
					name: 'no-npm',
					target: 'command',
					pattern: '^npm\\b',
					reason: 'Use pnpm.',
				},
			],
		};

		expect(
			should_block_coding_preference(
				event('bash', { command: 'npm install' }),
				config,
			),
		).toBe('Use pnpm.');
	});

	it('loads global naming preferences without replacing workflow defaults', () => {
		vi.mocked(read_settings_section).mockReturnValue({
			naming: { variables: 'camelCase' },
		});
		const dir = mkdtempSync(join(tmpdir(), 'pi-coding-preferences-'));
		expect(load_config(dir)).toEqual({
			rules: default_config.rules,
			naming: { variables: 'camelCase' },
		});
	});

	it('merges global and project naming preferences independently of rules', () => {
		vi.mocked(read_settings_section).mockReturnValue({
			rules: default_config.rules,
			naming: { variables: 'camelCase', types: false },
		});
		const dir = mkdtempSync(join(tmpdir(), 'pi-coding-preferences-'));
		write_project_config(dir, { naming: { functions: 'camelCase' } });
		expect(load_config(dir)).toEqual({
			rules: default_config.rules,
			naming: {
				variables: 'camelCase',
				functions: 'camelCase',
				types: false,
			},
		});
		write_project_config(dir, { naming: false });
		expect(load_config(dir).naming).toBe(false);
	});

	it('preserves a global naming disable unless a project explicitly enables it', () => {
		vi.mocked(read_settings_section).mockReturnValue({
			naming: false,
		});
		const dir = mkdtempSync(join(tmpdir(), 'pi-coding-preferences-'));
		write_project_config(dir, { rules: [] });
		expect(load_config(dir).naming).toBe(false);
		write_project_config(dir, { naming: { types: 'PascalCase' } });
		expect(load_config(dir).naming).toEqual({ types: 'PascalCase' });
	});

	it('rejects invalid naming configuration rather than silently disabling checks', () => {
		vi.mocked(read_settings_section).mockReturnValue({
			naming: { variables: 'invalid' },
		});
		expect(() => load_config()).toThrow(
			'Invalid codingPreferences.naming style',
		);
	});

	it('loads project config from .pi/coding-preferences.json', () => {
		const dir = mkdtempSync(join(tmpdir(), 'pi-coding-preferences-'));
		write_project_config(dir, {
			rules: [
				{
					name: 'no-yarn',
					toolNames: ['bash'],
					target: 'command',
					pattern: '^yarn\\b',
					reason: 'Use pnpm.',
				},
			],
		});

		expect(get_project_config_path(dir)).toBe(
			join(dir, '.pi', 'coding-preferences.json'),
		);
		expect(load_config(dir).rules[0]?.name).toBe('no-yarn');
	});
});
