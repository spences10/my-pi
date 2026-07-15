import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
	default_config,
	get_project_config_path,
	load_config,
	should_block_coding_preference,
	type CodingPreferencesConfig,
} from './index.js';

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
	config: CodingPreferencesConfig,
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
		vi.clearAllMocks();
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
