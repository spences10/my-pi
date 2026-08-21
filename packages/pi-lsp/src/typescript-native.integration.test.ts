import {
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { LspServerManager } from './server-manager.js';

const dirs: string[] = [];

const ctx = {
	hasUI: false,
	ui: { select: async () => undefined },
} as never;

afterEach(() => {
	for (const dir of dirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
});

describe('TypeScript 7 native LSP integration', () => {
	it('provides diagnostics and core navigation through the project-local native server', async () => {
		const previous_trust = process.env.MY_PI_LSP_PROJECT_BINARY;
		process.env.MY_PI_LSP_PROJECT_BINARY = 'allow';
		const workspace = mkdtempSync(
			join(process.cwd(), '.tmp-typescript-native-lsp-'),
		);
		dirs.push(workspace);
		mkdirSync(join(workspace, 'src'), { recursive: true });
		writeFileSync(
			join(workspace, 'package.json'),
			JSON.stringify({ private: true }),
		);
		writeFileSync(
			join(workspace, 'tsconfig.json'),
			JSON.stringify({ compilerOptions: { strict: true } }),
		);
		const file = join(workspace, 'src', 'index.ts');
		writeFileSync(
			file,
			[
				'export function greet(name: string): string {',
				'  return `Hello ${name}`;',
				'}',
				'export const message = greet("Pi");',
				'export const invalid: number = "wrong";',
				'',
			].join('\n'),
		);

		const manager = new LspServerManager({ cwd: () => workspace });
		try {
			const resolved = await manager.resolve_file_state(file, ctx);
			expect(resolved.ok).toBe(true);
			if (!resolved.ok) return;
			const { state, uri } = resolved.result;
			expect(state.backend).toBe('typescript-native');
			expect(state.args).toEqual(['--lsp', '--stdio']);

			const diagnostics = await state.client.wait_for_diagnostics(
				uri,
				5_000,
			);
			expect(diagnostics.some((item) => item.severity === 1)).toBe(
				true,
			);
			expect(
				await state.client.hover(uri, { line: 3, character: 25 }),
			).not.toBeNull();
			expect(
				await state.client.definition(uri, {
					line: 3,
					character: 25,
				}),
			).not.toHaveLength(0);
			expect(
				await state.client.references(
					uri,
					{ line: 0, character: 16 },
					true,
				),
			).not.toHaveLength(0);
			expect(
				await state.client.document_symbols(uri),
			).not.toHaveLength(0);
			await manager.release_file_state(resolved.result);
		} finally {
			await manager.clear_language_state();
			if (previous_trust === undefined) {
				delete process.env.MY_PI_LSP_PROJECT_BINARY;
			} else {
				process.env.MY_PI_LSP_PROJECT_BINARY = previous_trust;
			}
		}
	}, 20_000);
});
