import { describe, expect, it } from 'vitest';

describe('src/extensions/builtin-registry.ts', () => {
	it('loads without side effects', async () => {
		await expect(
			import('./builtin-registry.js'),
		).resolves.toBeDefined();
	});

	it('keeps the experimental factory disabled by default', async () => {
		const { BUILTIN_EXTENSION_REGISTRY } =
			await import('./builtin-registry.js');
		const factory = BUILTIN_EXTENSION_REGISTRY.find(
			(extension) => extension.key === 'factory',
		);

		expect(factory?.default_enabled).toBe(false);
	});

	it('marks package-backed built-ins so duplicate agent-dir installs are skipped', async () => {
		const { BUILTIN_EXTENSION_REGISTRY } =
			await import('./builtin-registry.js');
		const package_backed_keys = new Set([
			'context-sidecar',
			'factory',
			'mcp',
			'skills',
			'skill-importer',
			'filter-output',
			'recall',
			'nopeek',
			'observability',
			'harness',
			'omnisearch',
			'sqlite-tools',
			'git-ui',
			'lsp',
			'confirm-destructive',
			'svelte-guardrails',
			'coding-preferences',
			'team-mode',
		]);

		for (const extension of BUILTIN_EXTENSION_REGISTRY) {
			if (!package_backed_keys.has(extension.key)) continue;
			expect(
				(extension as { external_package_name?: string })
					.external_package_name,
			).toMatch(/^@spences10\/pi-/);
		}
	});
});
