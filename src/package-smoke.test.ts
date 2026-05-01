import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

interface PackFile {
	path: string;
}

interface PackResult {
	files: PackFile[];
}

describe('package smoke', () => {
	it('packs the CLI and public API entrypoints', () => {
		const raw = execFileSync(
			'pnpm',
			['pack', '--dry-run', '--json'],
			{
				encoding: 'utf-8',
			},
		);
		const result = JSON.parse(raw) as PackResult;
		const files = new Set(result.files.map((file) => file.path));
		const package_json = JSON.parse(
			readFileSync('package.json', 'utf-8'),
		) as {
			bin?: Record<string, string>;
			exports?: Record<string, unknown>;
		};

		expect(package_json.bin?.['my-pi']).toBe('./dist/index.js');
		expect(package_json.exports).toHaveProperty('.');
		for (const expected of [
			'package.json',
			'README.md',
			'dist/index.js',
			'dist/api.js',
			'dist/api.d.ts',
		]) {
			expect(files.has(expected)).toBe(true);
		}
	});

	it('runs the packed CLI help without user-global agent state', () => {
		const agent_dir = mkdtempSync(join(tmpdir(), 'my-pi-cli-smoke-'));
		try {
			const output = execFileSync(
				process.execPath,
				['dist/index.js', '--help'],
				{
					encoding: 'utf-8',
					env: {
						...process.env,
						PI_CODING_AGENT_DIR: agent_dir,
					},
				},
			);

			expect(output).toContain('my-pi');
			expect(output).toContain('--agent-dir');
		} finally {
			rmSync(agent_dir, { recursive: true, force: true });
		}
	});
});
