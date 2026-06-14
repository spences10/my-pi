import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite-plus';

export default defineConfig({
	plugins: [
		{
			name: 'raw-markdown',
			load(id) {
				if (!id.endsWith('.md')) return undefined;
				return `export default ${JSON.stringify(readFileSync(id, 'utf-8'))};`;
			},
		},
	],
	pack: {
		entry: ['src/index.ts', 'src/api.ts'],
		format: ['esm'],
		loader: { '.md': 'text' },
		sourcemap: true,
		outExtensions: () => ({ js: '.js' }),
		dts: true,
	},
	test: {
		include: ['src/**/*.test.ts'],
		setupFiles: [
			fileURLToPath(
				new URL('./src/test/setup-warnings.ts', import.meta.url),
			),
		],
	},
	fmt: {
		useTabs: true,
		singleQuote: true,
		printWidth: 70,
		trailingComma: 'all',
		proseWrap: 'always',
		ignorePatterns: ['apps/web/worker-configuration.d.ts'],
	},
	lint: {
		ignorePatterns: [
			'.svelte-kit/**',
			'build/**',
			'dist/**',
			'worker-configuration.d.ts',
			'apps/web/.svelte-kit/**',
			'apps/web/build/**',
			'apps/web/dist/**',
			'apps/web/worker-configuration.d.ts',
		],
		options: {
			typeAware: true,
			typeCheck: true,
		},
	},
});
