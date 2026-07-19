import { execFileSync, spawnSync } from 'node:child_process';
import {
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

interface PackFile {
	path: string;
}

interface PackResult {
	files: PackFile[];
}

function write_node_version_preload(
	directory: string,
	version: string,
): string {
	const path = join(directory, 'node-version.cjs');
	writeFileSync(
		path,
		`Object.defineProperty(process.versions, 'node', { value: ${JSON.stringify(version)} });\n`,
	);
	return path;
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
			pnpm?: unknown;
		};

		expect(package_json.bin?.['my-pi']).toBe('./dist/index.js');
		expect(package_json.exports).toHaveProperty('.');
		expect(package_json.pnpm).toBeUndefined();
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

	it('runs the packed CLI help at the minimum Node version', () => {
		const agent_dir = mkdtempSync(join(tmpdir(), 'my-pi-cli-smoke-'));
		try {
			const preload = write_node_version_preload(
				agent_dir,
				'24.15.0',
			);
			const output = execFileSync(
				process.execPath,
				['--require', preload, 'dist/index.js', '--help'],
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

	it('fails the packed CLI cleanly below the minimum Node version', () => {
		const agent_dir = mkdtempSync(join(tmpdir(), 'my-pi-cli-smoke-'));
		try {
			const preload = write_node_version_preload(
				agent_dir,
				'24.14.0',
			);
			const result = spawnSync(
				process.execPath,
				['--require', preload, 'dist/index.js', '--help'],
				{
					encoding: 'utf-8',
					env: {
						...process.env,
						PI_CODING_AGENT_DIR: agent_dir,
					},
				},
			);

			expect(result.status).toBe(1);
			expect(result.stdout).toBe('');
			expect(result.stderr).toBe(
				'my-pi requires Node >=24.15.0; current version is 24.14.0. Upgrade Node and retry.\n',
			);
		} finally {
			rmSync(agent_dir, { recursive: true, force: true });
		}
	});
});
