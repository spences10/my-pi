import { describe, expect, it } from 'vitest';
import {
	find_builtin_extension,
	is_builtin_extension_active,
	is_builtin_extension_enabled,
	resolve_builtin_extension_states,
	type BuiltinExtensionsConfig,
} from './config.js';

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
		expect(find_builtin_extension('language-server')?.key).toBe(
			'lsp',
		);
		expect(find_builtin_extension('auto-name')?.key).toBe(
			'session-name',
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
				handoff: false,
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

		const handoff = states.find((state) => state.key === 'handoff');
		expect(handoff).toMatchObject({
			saved_enabled: false,
			effective_enabled: false,
			forced_disabled: false,
		});
	});
});
