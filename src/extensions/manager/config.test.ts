import { describe, expect, it } from 'vitest';
import { BUILTIN_EXTENSION_REGISTRY } from '../builtin-registry.js';
import {
	BUILTIN_EXTENSIONS,
	find_builtin_extension,
	is_builtin_extension_active,
	is_builtin_extension_enabled,
	resolve_builtin_extension_states,
	type BuiltinExtensionsConfig,
} from './config.js';

describe('BUILTIN_EXTENSION_REGISTRY', () => {
	it('has consistent unique metadata for every built-in', () => {
		const keys = new Set<string>();
		const options = new Set<string>();
		const flags = new Set<string>();

		for (const extension of BUILTIN_EXTENSION_REGISTRY) {
			expect(extension.default_enabled).toBe(true);
			expect(extension.label).toBeTruthy();
			expect(extension.docs_label).toBeTruthy();
			expect(extension.cli_arg).toBe(
				extension.cli_flag.slice('--'.length),
			);
			expect(extension.cli_flag).toMatch(/^--no-/);
			expect(extension.option_name).toMatch(/^[a-z][a-z0-9_]*$/);
			expect(extension.load).toEqual(expect.any(Function));
			expect(keys.has(extension.key)).toBe(false);
			expect(options.has(extension.option_name)).toBe(false);
			expect(flags.has(extension.cli_flag)).toBe(false);
			keys.add(extension.key);
			options.add(extension.option_name);
			flags.add(extension.cli_flag);
		}
	});

	it('keeps manager-visible built-ins in registry order', () => {
		expect(
			BUILTIN_EXTENSIONS.map((extension) => extension.key),
		).toEqual(
			BUILTIN_EXTENSION_REGISTRY.map((extension) => extension.key),
		);
	});
});

describe('find_builtin_extension', () => {
	it('finds canonical keys', () => {
		expect(find_builtin_extension('mcp')?.key).toBe('mcp');
		expect(find_builtin_extension('filter-output')?.key).toBe(
			'filter-output',
		);
	});

	it('finds aliases', () => {
		expect(find_builtin_extension('filter')?.key).toBe(
			'filter-output',
		);
		expect(find_builtin_extension('skill')?.key).toBe('skills');
		expect(find_builtin_extension('preset')?.key).toBe(
			'prompt-presets',
		);
		expect(find_builtin_extension('prompt-preset')?.key).toBe(
			'prompt-presets',
		);
		expect(find_builtin_extension('language-server')?.key).toBe(
			'lsp',
		);
		expect(find_builtin_extension('auto-name')?.key).toBe(
			'session-name',
		);
		expect(find_builtin_extension('confirm')?.key).toBe(
			'confirm-destructive',
		);
		expect(find_builtin_extension('hooks')?.key).toBe(
			'hooks-resolution',
		);
	});
});

describe('is_builtin_extension_enabled', () => {
	it('defaults to enabled when unset', () => {
		const config: BuiltinExtensionsConfig = {
			version: 1,
			enabled: {},
		};
		expect(is_builtin_extension_enabled(config, 'recall')).toBe(true);
	});

	it('returns explicit saved state', () => {
		const config: BuiltinExtensionsConfig = {
			version: 1,
			enabled: { recall: false },
		};
		expect(is_builtin_extension_enabled(config, 'recall')).toBe(
			false,
		);
	});
});

describe('is_builtin_extension_active', () => {
	it('applies force-disabled overlay', () => {
		const config: BuiltinExtensionsConfig = {
			version: 1,
			enabled: { recall: true },
		};
		const force_disabled = new Set(['recall'] as const);
		expect(
			is_builtin_extension_active(config, 'recall', force_disabled),
		).toBe(false);
	});
});

describe('resolve_builtin_extension_states', () => {
	it('reports saved and effective state separately', () => {
		const config: BuiltinExtensionsConfig = {
			version: 1,
			enabled: {
				recall: true,
				'session-name': false,
			},
		};
		const force_disabled = new Set(['recall'] as const);
		const states = resolve_builtin_extension_states(
			force_disabled,
			config,
		);

		const recall = states.find((state) => state.key === 'recall');
		expect(recall).toMatchObject({
			saved_enabled: true,
			effective_enabled: false,
			forced_disabled: true,
		});

		const session_name = states.find(
			(state) => state.key === 'session-name',
		);
		expect(session_name).toMatchObject({
			saved_enabled: false,
			effective_enabled: false,
			forced_disabled: false,
		});
	});
});
