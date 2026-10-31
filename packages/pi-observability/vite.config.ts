import { svelte } from '@sveltejs/vite-plugin-svelte';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite-plus';

// Builds the dashboard into dist/web; server.ts serves it from there.
export default defineConfig({
	plugins: [tailwindcss(), svelte()],
	root: 'src/web',
	base: '/',
	build: {
		outDir: '../../dist/web',
		emptyOutDir: true,
		// Fonts stay files under /assets/ so the server serves them.
		assetsInlineLimit: 0,
	},
	test: {
		root: '.',
		include: ['src/**/*.test.ts'],
	},
});
