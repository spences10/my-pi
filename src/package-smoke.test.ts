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
	const cli_path = join(process.cwd(), 'dist', 'index.js');

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

	it('forwards spaced and equals extension flags through the packed CLI', () => {
		const cwd = mkdtempSync(join(tmpdir(), 'my-pi-cli-flags-'));
		const extension_path = join(cwd, 'flag-probe.ts');
		writeFileSync(
			extension_path,
			`import { writeFileSync } from 'node:fs';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
export default function flag_probe(pi: ExtensionAPI) {
  pi.registerFlag('probe-string', { type: 'string' });
  pi.registerFlag('probe-boolean', { type: 'boolean' });
  pi.on('session_start', () => writeFileSync(
    process.env.FLAG_PROBE_OUT!,
    JSON.stringify({
      string: pi.getFlag('probe-string') ?? null,
      boolean: pi.getFlag('probe-boolean') ?? null,
    }),
  ));
}
`,
		);

		try {
			for (const [name, flags] of [
				['spaced', ['--probe-string', 'alpha', '--probe-boolean']],
				['equals', ['--probe-string=alpha', '--probe-boolean=true']],
			] as const) {
				const output_path = join(cwd, `${name}.json`);
				const result = spawnSync(
					process.execPath,
					[
						cli_path,
						'--agent-dir',
						join(cwd, `agent-${name}`),
						'--no-builtin',
						'-e',
						extension_path,
						'--mode',
						'rpc',
						...flags,
					],
					{
						cwd,
						encoding: 'utf-8',
						env: {
							...process.env,
							FLAG_PROBE_OUT: output_path,
						},
						timeout: 30_000,
					},
				);

				expect(result.status, result.stderr).toBe(0);
				expect(
					JSON.parse(readFileSync(output_path, 'utf-8')),
				).toEqual({ string: 'alpha', boolean: true });
			}
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it('fails clearly for missing and unknown extension flags', () => {
		const cwd = mkdtempSync(join(tmpdir(), 'my-pi-cli-flag-errors-'));
		const extension_path = join(cwd, 'flag-errors.ts');
		writeFileSync(
			extension_path,
			`import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
export default function flag_errors(pi: ExtensionAPI) {
  pi.registerFlag('probe-string', { type: 'string' });
}
`,
		);

		try {
			for (const [name, flags, message] of [
				[
					'missing',
					['--probe-string'],
					'Extension flag "--probe-string" requires a value',
				],
				[
					'unknown',
					['--missing-flag'],
					'Unknown option: --missing-flag',
				],
			] as const) {
				const result = spawnSync(
					process.execPath,
					[
						cli_path,
						'--agent-dir',
						join(cwd, `agent-${name}`),
						'--no-builtin',
						'-e',
						extension_path,
						'--mode',
						'rpc',
						...flags,
					],
					{ cwd, encoding: 'utf-8', timeout: 30_000 },
				);

				expect(result.status).toBe(1);
				expect(result.stderr).toContain(`Error: ${message}`);
			}
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	});

	it('captures selected presets and excludes default-disabled tools from the effective prompt', () => {
		const cwd = mkdtempSync(join(tmpdir(), 'my-pi-cli-prompt-'));
		const extension_path = join(cwd, 'prompt-capture.ts');
		const output_path = join(cwd, 'effective-prompt.txt');
		writeFileSync(
			extension_path,
			`import { writeFileSync } from 'node:fs';
import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
export default function prompt_capture(pi: ExtensionAPI) {
  pi.registerProvider('capture-provider', {
    name: 'Capture Provider',
    baseUrl: 'http://127.0.0.1:1/v1',
    apiKey: 'test-key',
    api: 'openai-completions',
    models: [{
      id: 'capture-model',
      name: 'Capture Model',
      reasoning: false,
      input: ['text'],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: 10000,
      maxTokens: 100,
    }],
  });
  pi.on('before_agent_start', (event) => {
    writeFileSync(process.env.PROMPT_CAPTURE_OUT!, event.systemPrompt);
    process.exit(0);
  });
}
`,
		);

		try {
			const result = spawnSync(
				process.execPath,
				[
					cli_path,
					'--agent-dir',
					join(cwd, 'agent'),
					'--no-observability',
					'-e',
					extension_path,
					'--model',
					'capture-provider/capture-model',
					'--preset',
					'asd-ste100',
					'--prompt',
					'test prompt',
				],
				{
					cwd,
					encoding: 'utf-8',
					env: {
						...process.env,
						PI_OFFLINE: '1',
						PROMPT_CAPTURE_OUT: output_path,
					},
					timeout: 30_000,
				},
			);

			expect(result.status, result.stderr).toBe(0);
			const effective_prompt = readFileSync(output_path, 'utf-8');
			expect(effective_prompt).toContain(
				'Use ASD-STE100 Simplified Technical English in all replies.',
			);
			expect(effective_prompt).not.toContain('factory_start');
		} finally {
			rmSync(cwd, { recursive: true, force: true });
		}
	}, 30_000);

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
