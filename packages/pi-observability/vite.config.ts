import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite-plus';

export default defineConfig({
	plugins: [svelte()],
	root: 'src/web',
	base: '/',
	build: {
		outDir: '../../dist/web',
		emptyOutDir: true,
	},
	test: {
		root: '.',
		include: ['src/**/*.test.ts'],
	},
});
