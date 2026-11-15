import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite-plus';

export default defineConfig({
	resolve: {
		// Package-local Vite+ installations can resolve different Vitest instances.
		alias: [
			{
				find: /^vite-plus\/test$/,
				replacement: fileURLToPath(import.meta.resolve('vitest')),
			},
		],
	},
	test: {
		environment: 'node',
		include: [
			`${process.env.MUTATION_TEST_DIR ?? 'packages/pi-coding-preferences'}/src/**/*.test.ts`,
		],
	},
});
