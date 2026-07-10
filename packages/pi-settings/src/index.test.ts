import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
	extract_input_strings,
	get_settings_path,
	read_package_settings,
	read_settings,
	read_trust_settings,
	write_package_settings,
	write_settings,
	write_trust_settings,
} from './index.js';

const original_agent_dir = process.env.PI_CODING_AGENT_DIR;
let agent_dir: string | undefined;

function use_temp_agent_dir(): string {
	agent_dir = mkdtempSync(join(tmpdir(), 'pi-settings-'));
	process.env.PI_CODING_AGENT_DIR = agent_dir;
	return agent_dir;
}

afterEach(() => {
	if (agent_dir) rmSync(agent_dir, { recursive: true, force: true });
	agent_dir = undefined;
	if (original_agent_dir === undefined)
		delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = original_agent_dir;
});

describe('@spences10/pi-settings', () => {
	it('returns defaults when the settings file does not exist', () => {
		use_temp_agent_dir();

		expect(read_settings()).toEqual({
			version: 1,
			extensions: { enabled: {} },
			trust: {},
			packages: {},
		});
	});

	it('writes settings atomically with version 1', () => {
		use_temp_agent_dir();

		write_settings({
			version: 1,
			extensions: { enabled: { mcp: false } },
		});

		expect(read_settings()).toMatchObject({
			version: 1,
			extensions: { enabled: { mcp: false } },
		});
		expect(
			JSON.parse(readFileSync(get_settings_path(), 'utf-8')),
		).toEqual({
			version: 1,
			extensions: { enabled: { mcp: false } },
		});
	});

	it('extracts nested input strings from arrays and objects', () => {
		expect(
			extract_input_strings({
				command: 'pnpm test',
				meta: [{ path: 'src/App.svelte' }, false, null],
				count: 1,
			}),
		).toEqual(['pnpm test', 'src/App.svelte']);
	});

	it('reads and writes package and trust sections', () => {
		use_temp_agent_dir();

		expect(read_package_settings('demo', { enabled: false })).toEqual(
			{
				enabled: false,
			},
		);
		write_package_settings('demo', { enabled: true });
		expect(read_package_settings('demo', { enabled: false })).toEqual(
			{
				enabled: true,
			},
		);

		expect(read_trust_settings('hooks', [])).toEqual([]);
		write_trust_settings('hooks', ['repo']);
		expect(read_trust_settings('hooks', [])).toEqual(['repo']);
	});
});
