import { defineConfig } from 'vite-plus';

export default defineConfig({
	fmt: {
		useTabs: true,
		singleQuote: true,
		printWidth: 70,
		trailingComma: 'all',
		proseWrap: 'always',
		ignorePatterns: [
			'.agents/**',
			'.claude/**',
			'tools/oxlint/anti-slop/**',
			'apps/web/.svelte-kit/**',
			'apps/web/worker-configuration.d.ts',
		],
		overrides: [
			{
				files: ['apps/web/src/**/*.svelte'],
				options: {
					svelte: true,
					sortTailwindcss: {
						stylesheet: './apps/web/src/routes/layout.css',
					},
				},
			},
			{
				files: ['packages/pi-observability/src/web/**/*.svelte'],
				options: {
					svelte: true,
					sortTailwindcss: {
						stylesheet:
							'./packages/pi-observability/src/web/src/layout.css',
					},
				},
			},
		],
	},
	lint: {
		jsPlugins: [
			'./tools/lint-rules.ts',
			{
				name: 'anti-slop',
				specifier: './tools/oxlint/anti-slop/index.ts',
			},
		],
		rules: {
			'typescript/no-explicit-any': 'error',
			'my-pi/no-nested-ternary': 'error',
			'oxc/no-accumulating-spread': 'error',
			'anti-slop/no-array-filter-map': 'error',
			'anti-slop/no-reduce-accumulator-copy': 'error',
			'anti-slop/no-chained-type-assertions': 'error',
			'anti-slop/no-conditional-empty-object-spread': 'error',
			'anti-slop/no-known-value-widening': 'error',
			'anti-slop/no-reflect-apply': 'error',
			'anti-slop/no-reflect-get': 'error',
			'anti-slop/no-widen-then-assert': 'error',

			'anti-slop/no-object-parameters': 'error',
			'anti-slop/no-unknown-parameters': 'error',
			'anti-slop/no-unknown-returns': 'error',
			'anti-slop/no-unknown-type-aliases': 'error',
			'anti-slop/no-unsafe-dictionary-type': 'error',
			'anti-slop/require-readable-spacing': 'error',
			'anti-slop/require-safety-comment-for-type-assertion': 'error',

			'anti-slop/no-runtime-typeof': 'error',
		},
		overrides: [
			{
				// These synthetic transports serialize varied test protocol messages.
				files: [
					'packages/pi-workers/src/fixtures/rpc-child.ts',
					'packages/pi-workers/src/fixtures/process-tree.ts',
					'packages/pi-workers/src/fixtures/diagnostic-child.ts',
					'packages/pi-lsp/test/synthetic-server.ts',
				],
				rules: { 'anti-slop/no-object-parameters': 'off' },
			},
		],
		ignorePatterns: [
			'.agents/**',
			'.claude/**',
			'tools/oxlint/anti-slop/**',
			'.svelte-kit/**',
			'build/**',
			'dist/**',
			'worker-configuration.d.ts',
			'apps/web/**',
		],
		options: {
			typeAware: true,
			typeCheck: true,
		},
	},
});
