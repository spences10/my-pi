import { describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomBytes } from 'node:crypto';

// Test the config file format parsing directly
// (load_mcp_config merges global ~/.pi config which is machine-specific)

interface McpConfigFile {
	mcpServers: Record<
		string,
		{
			command: string;
			args?: string[];
			env?: Record<string, string>;
		}
	>;
}

function read_config(
	path: string,
): McpConfigFile['mcpServers'] {
	if (!existsSync(path)) return {};
	const raw = readFileSync(path, 'utf-8');
	const config = JSON.parse(raw) as McpConfigFile;
	return config.mcpServers || {};
}

function tmp_dir(): string {
	const dir = join(
		tmpdir(),
		`my-pi-test-${randomBytes(4).toString('hex')}`,
	);
	mkdirSync(dir, { recursive: true });
	return dir;
}

describe('mcp config parsing', () => {
	it('returns empty for missing file', () => {
		const dir = tmp_dir();
		const result = read_config(
			join(dir, 'mcp.json'),
		);
		expect(Object.keys(result)).toHaveLength(0);
	});

	it('parses servers with command and args', () => {
		const dir = tmp_dir();
		const path = join(dir, 'mcp.json');
		writeFileSync(
			path,
			JSON.stringify({
				mcpServers: {
					'test-server': {
						command: 'npx',
						args: ['-y', 'some-package'],
					},
				},
			}),
		);

		const result = read_config(path);
		expect(result['test-server']).toBeDefined();
		expect(result['test-server'].command).toBe('npx');
		expect(result['test-server'].args).toEqual([
			'-y',
			'some-package',
		]);
	});

	it('parses servers with env vars', () => {
		const dir = tmp_dir();
		const path = join(dir, 'mcp.json');
		writeFileSync(
			path,
			JSON.stringify({
				mcpServers: {
					myserver: {
						command: 'node',
						args: ['server.js'],
						env: {
							API_KEY: 'test123',
							OTHER: 'value',
						},
					},
				},
			}),
		);

		const result = read_config(path);
		expect(result['myserver'].env).toEqual({
			API_KEY: 'test123',
			OTHER: 'value',
		});
	});

	it('parses multiple servers', () => {
		const dir = tmp_dir();
		const path = join(dir, 'mcp.json');
		writeFileSync(
			path,
			JSON.stringify({
				mcpServers: {
					server_a: { command: 'a' },
					server_b: { command: 'b' },
					server_c: { command: 'c' },
				},
			}),
		);

		const result = read_config(path);
		expect(Object.keys(result)).toHaveLength(3);
	});

	it('returns empty for file with no mcpServers key', () => {
		const dir = tmp_dir();
		const path = join(dir, 'mcp.json');
		writeFileSync(path, JSON.stringify({ other: true }));

		const result = read_config(path);
		expect(Object.keys(result)).toHaveLength(0);
	});

	it('throws on invalid JSON', () => {
		const dir = tmp_dir();
		const path = join(dir, 'mcp.json');
		writeFileSync(path, 'not valid json');

		expect(() => read_config(path)).toThrow();
	});

	it('project overrides global by name via merge', () => {
		const global_servers = {
			shared: { command: 'global-cmd' },
			'global-only': { command: 'g' },
		};
		const project_servers = {
			shared: { command: 'project-cmd' },
			'project-only': { command: 'p' },
		};

		const merged = {
			...global_servers,
			...project_servers,
		};

		expect(merged['shared'].command).toBe(
			'project-cmd',
		);
		expect(merged['global-only'].command).toBe('g');
		expect(merged['project-only'].command).toBe('p');
	});
});
