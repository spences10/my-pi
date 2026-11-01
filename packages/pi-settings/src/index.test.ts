import {
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	statSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vite-plus/test';
import {
	extract_input_strings,
	get_settings_path,
	read_package_settings,
	read_settings,
	read_settings_section,
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
	it('resolves the global settings file in the configured agent directory', () => {
		const dir = use_temp_agent_dir();

		expect(get_settings_path()).toBe(
			join(dir, 'my-pi-settings.json'),
		);
	});

	it('returns defaults when the settings file does not exist', () => {
		use_temp_agent_dir();

		expect(read_settings()).toEqual({
			version: 1,
			extensions: { enabled: {} },
			trust: {},
			packages: {},
		});
		expect(
			read_settings_section('codingPreferences', 'fallback'),
		).toBe('fallback');
	});

	it('merges defaults into a partially populated settings file', () => {
		use_temp_agent_dir();
		write_settings({
			version: 1,
			codingPreferences: { profile: 'strict' },
		});

		expect(read_settings()).toEqual({
			version: 1,
			extensions: { enabled: {} },
			trust: {},
			packages: {},
			codingPreferences: { profile: 'strict' },
		});
	});

	it.each([false, 0, '', null, []])(
		'preserves an explicitly saved section value of %j instead of using the fallback',
		(value) => {
			use_temp_agent_dir();
			write_settings({ version: 1, codingPreferences: value });

			expect(
				read_settings_section<unknown>(
					'codingPreferences',
					'fallback',
				),
			).toEqual(value);
		},
	);

	it('replaces existing settings without leaving temporary files', () => {
		const dir = use_temp_agent_dir();
		write_settings({
			version: 1,
			extensions: { enabled: { mcp: true } },
		});

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
		expect(readdirSync(dir)).toEqual(['my-pi-settings.json']);
	});

	it.skipIf(process.platform === 'win32')(
		'creates missing agent directories and settings files with private permissions',
		() => {
			const dir = use_temp_agent_dir();
			const nested_agent_dir = join(dir, 'nested', 'agent');
			process.env.PI_CODING_AGENT_DIR = nested_agent_dir;

			write_settings({ version: 1 });

			expect(statSync(nested_agent_dir).mode & 0o777).toBe(0o700);
			expect(statSync(get_settings_path()).mode & 0o777).toBe(0o600);
			expect(read_settings().version).toBe(1);
		},
	);

	it('reports malformed JSON without overwriting the settings file', () => {
		use_temp_agent_dir();
		writeFileSync(get_settings_path(), '{invalid json');

		expect(() => read_settings()).toThrow(SyntaxError);
		expect(readFileSync(get_settings_path(), 'utf-8')).toBe(
			'{invalid json',
		);
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

		expect(read_trust_settings('lspBinaries', [])).toEqual([]);
		write_trust_settings('lspBinaries', ['repo']);
		expect(read_trust_settings('lspBinaries', [])).toEqual(['repo']);
	});

	it('preserves unrelated settings and namespaces during package and trust updates', () => {
		use_temp_agent_dir();
		write_settings({
			version: 1,
			extensions: { enabled: { footer: false } },
			codingPreferences: { profile: 'strict' },
			packages: {
				footer: { preset: 'compact' },
				demo: { enabled: true },
			},
			trust: { existing: ['repo-a'], lspBinaries: ['old-repo'] },
		});

		write_package_settings('demo', { enabled: false });
		write_trust_settings('lspBinaries', ['new-repo']);

		expect(read_settings()).toEqual({
			version: 1,
			extensions: { enabled: { footer: false } },
			codingPreferences: { profile: 'strict' },
			packages: {
				footer: { preset: 'compact' },
				demo: { enabled: false },
			},
			trust: { existing: ['repo-a'], lspBinaries: ['new-repo'] },
		});
	});

	it.each([null, undefined])(
		'uses fallbacks for %j package and trust sections and can populate them',
		(value) => {
			use_temp_agent_dir();
			writeFileSync(
				get_settings_path(),
				JSON.stringify({ version: 1, packages: value, trust: value }),
			);

			expect(read_package_settings('demo', false)).toBe(false);
			expect(read_trust_settings('resources', [])).toEqual([]);

			write_package_settings('demo', true);
			write_trust_settings('resources', ['repo']);

			expect(read_package_settings('demo', false)).toBe(true);
			expect(read_trust_settings('resources', [])).toEqual(['repo']);
		},
	);
});
