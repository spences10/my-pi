import { defineConfig } from 'vite-plus';

export default defineConfig({
	fmt: {
		useTabs: true,
		singleQuote: true,
		printWidth: 70,
		trailingComma: 'all',
		proseWrap: 'always',
		ignorePatterns: [
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
		rules: {
			'typescript/no-explicit-any': 'error',
		},
		ignorePatterns: [
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
