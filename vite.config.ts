import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite-plus';

export default defineConfig({
	pack: {
		entry: ['src/index.ts', 'src/api.ts'],
		format: ['esm'],
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
	},
	lint: {
		options: {
			typeAware: true,
			typeCheck: true,
		},
	},
});
