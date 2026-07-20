import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	BUILTIN_EXTENSIONS,
	type BuiltinExtensionOptionName,
} from '../extensions/builtin-registry.js';
import {
	create_extensions_override,
	create_lazy_builtin_extension_factory,
	get_externally_installed_builtin_extensions,
	get_force_disabled_builtins,
} from './builtin-extensions.js';

const original_xdg_config_home = process.env.XDG_CONFIG_HOME;
const original_agent_dir = process.env.PI_CODING_AGENT_DIR;
let isolated_config_dirs: string[] = [];

function builtin_options(
	enabled: boolean,
): Partial<Record<BuiltinExtensionOptionName, boolean>> {
	return Object.fromEntries(
		BUILTIN_EXTENSIONS.map((extension) => [
			extension.option_name,
			enabled,
		]),
	) as Partial<Record<BuiltinExtensionOptionName, boolean>>;
}

beforeEach(() => {
	const xdg_config_home = mkdtempSync(
		join(tmpdir(), 'my-pi-builtins-config-'),
	);
	const agent_dir = mkdtempSync(
		join(tmpdir(), 'my-pi-builtins-agent-'),
	);
	isolated_config_dirs.push(xdg_config_home, agent_dir);
	process.env.XDG_CONFIG_HOME = xdg_config_home;
	process.env.PI_CODING_AGENT_DIR = agent_dir;
});

afterEach(() => {
	if (original_xdg_config_home === undefined)
		delete process.env.XDG_CONFIG_HOME;
	else process.env.XDG_CONFIG_HOME = original_xdg_config_home;
	if (original_agent_dir === undefined)
		delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = original_agent_dir;
	for (const dir of isolated_config_dirs)
		rmSync(dir, { recursive: true, force: true });
	isolated_config_dirs = [];
});

describe('builtin extension api helpers', () => {
	it('combines explicit disables with runtime mode constraints', () => {
		const disabled = get_force_disabled_builtins({
			...builtin_options(true),
			runtime_mode: 'print',
			mcp: false,
		});

		expect(disabled.has('mcp')).toBe(true);
		expect(disabled.has('startup-screen')).toBe(true);
		expect(disabled.has('confirm-destructive')).toBe(false);
	});

	it('detects externally installed built-ins under the agent npm dir', () => {
		const agent_dir = mkdtempSync(join(tmpdir(), 'my-pi-builtins-'));
		try {
			mkdirSync(
				join(
					agent_dir,
					'npm',
					'node_modules',
					'@spences10',
					'pi-observability',
				),
				{ recursive: true },
			);

			expect(
				get_externally_installed_builtin_extensions(agent_dir),
			).toContain('observability');
		} finally {
			rmSync(agent_dir, { recursive: true, force: true });
		}
	});

	it('loads lazy built-ins only when they are active', async () => {
		let loaded = 0;
		const disabled = create_lazy_builtin_extension_factory(
			'mcp',
			async () => {
				loaded++;
				return async () => undefined;
			},
			new Set(['mcp']),
		);
		await disabled({} as never);
		expect(loaded).toBe(0);

		const enabled = create_lazy_builtin_extension_factory(
			'mcp',
			async () => {
				loaded++;
				return async () => undefined;
			},
			new Set(),
		);
		await enabled({} as never);
		expect(loaded).toBe(1);
	});

	it('keeps managed extensions in precedence order before user extensions', () => {
		const override = create_extensions_override([
			'<inline:my-pi-telemetry>',
			'<inline:my-pi-mcp>',
		]);
		const result = override({
			extensions: [
				{ path: '/user', commands: new Map(), tools: new Map() },
				{
					path: '<inline:my-pi-mcp>',
					commands: new Map(),
					tools: new Map(),
				},
				{
					path: '<inline:my-pi-telemetry>',
					commands: new Map(),
					tools: new Map(),
				},
				{
					path: '<inline:consumer>',
					commands: new Map(),
					tools: new Map(),
				},
			],
		} as Parameters<typeof override>[0]);

		expect(
			result.extensions.map((extension) => extension.path),
		).toEqual([
			'<inline:my-pi-telemetry>',
			'<inline:my-pi-mcp>',
			'/user',
			'<inline:consumer>',
		]);
	});
});
