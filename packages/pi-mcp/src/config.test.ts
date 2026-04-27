import { randomBytes } from 'node:crypto';
import {
	existsSync,
	mkdirSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
	get_project_mcp_config_info,
	load_mcp_config,
} from './config.js';

function tmp_dir(): string {
	const dir = join(
		tmpdir(),
		`my-pi-test-${randomBytes(4).toString('hex')}`,
	);
	mkdirSync(dir, { recursive: true });
	return dir;
}

describe('load_mcp_config', () => {
	const dirs: string[] = [];
	const original_home = process.env.HOME;

	afterEach(() => {
		for (const dir of dirs.splice(0)) {
			rmSync(dir, { recursive: true, force: true });
		}
		if (original_home === undefined) {
			delete process.env.HOME;
		} else {
			process.env.HOME = original_home;
		}
	});

	it('returns empty for missing config files', () => {
		const home = tmp_dir();
		const cwd = tmp_dir();
		dirs.push(home, cwd);
		process.env.HOME = home;

		expect(load_mcp_config(cwd)).toEqual([]);
	});

	it('parses stdio servers', () => {
		const home = tmp_dir();
		const cwd = tmp_dir();
		dirs.push(home, cwd);
		process.env.HOME = home;

		writeFileSync(
			join(cwd, 'mcp.json'),
			JSON.stringify({
				mcpServers: {
					local: {
						command: 'npx',
						args: ['-y', 'some-package'],
						env: { API_KEY: 'test123' },
					},
				},
			}),
		);

		expect(load_mcp_config(cwd)).toEqual([
			{
				name: 'local',
				transport: 'stdio',
				command: 'npx',
				args: ['-y', 'some-package'],
				env: { API_KEY: 'test123' },
			},
		]);
	});

	it('parses http servers with headers', () => {
		const home = tmp_dir();
		const cwd = tmp_dir();
		dirs.push(home, cwd);
		process.env.HOME = home;

		writeFileSync(
			join(cwd, 'mcp.json'),
			JSON.stringify({
				mcpServers: {
					remote: {
						type: 'http',
						url: 'https://example.com/mcp',
						headers: {
							Authorization: 'Bearer test',
						},
					},
				},
			}),
		);

		expect(load_mcp_config(cwd)).toEqual([
			{
				name: 'remote',
				transport: 'http',
				url: 'https://example.com/mcp',
				headers: { Authorization: 'Bearer test' },
			},
		]);
	});

	it('can skip project config while keeping global config', () => {
		const home = tmp_dir();
		const cwd = tmp_dir();
		dirs.push(home, cwd);
		process.env.HOME = home;

		const global_dir = join(home, '.pi', 'agent');
		mkdirSync(global_dir, { recursive: true });
		writeFileSync(
			join(global_dir, 'mcp.json'),
			JSON.stringify({
				mcpServers: {
					shared: { command: 'global-cmd' },
				},
			}),
		);
		writeFileSync(
			join(cwd, 'mcp.json'),
			JSON.stringify({
				mcpServers: {
					shared: { command: 'project-cmd' },
				},
			}),
		);

		expect(load_mcp_config(cwd, { include_project: false })).toEqual([
			{
				name: 'shared',
				transport: 'stdio',
				command: 'global-cmd',
			},
		]);
	});

	it('reports project config path, hash, and server summaries', () => {
		const home = tmp_dir();
		const cwd = tmp_dir();
		dirs.push(home, cwd);
		process.env.HOME = home;

		writeFileSync(
			join(cwd, 'mcp.json'),
			JSON.stringify({
				mcpServers: {
					local: { command: 'npx', args: ['-y', 'server'] },
					remote: { type: 'http', url: 'https://example.com/mcp' },
				},
			}),
		);

		expect(get_project_mcp_config_info(cwd)).toMatchObject({
			path: join(cwd, 'mcp.json'),
			servers: [
				{ name: 'local', summary: 'stdio npx -y server' },
				{ name: 'remote', summary: 'http https://example.com/mcp' },
			],
		});
		expect(get_project_mcp_config_info(cwd)?.hash).toHaveLength(64);
	});

	it('lets project config override global config by name', () => {
		const home = tmp_dir();
		const cwd = tmp_dir();
		dirs.push(home, cwd);
		process.env.HOME = home;

		const global_dir = join(home, '.pi', 'agent');
		mkdirSync(global_dir, { recursive: true });
		writeFileSync(
			join(global_dir, 'mcp.json'),
			JSON.stringify({
				mcpServers: {
					shared: { command: 'global-cmd' },
					globalOnly: { command: 'g' },
				},
			}),
		);
		writeFileSync(
			join(cwd, 'mcp.json'),
			JSON.stringify({
				mcpServers: {
					shared: {
						type: 'http',
						url: 'https://example.com/mcp',
					},
					projectOnly: { command: 'p' },
				},
			}),
		);

		const configs = load_mcp_config(cwd);
		expect(configs).toEqual([
			{
				name: 'shared',
				transport: 'http',
				url: 'https://example.com/mcp',
			},
			{
				name: 'globalOnly',
				transport: 'stdio',
				command: 'g',
			},
			{
				name: 'projectOnly',
				transport: 'stdio',
				command: 'p',
			},
		]);
	});

	it('throws a clear error for invalid config shapes', () => {
		const home = tmp_dir();
		const cwd = tmp_dir();
		dirs.push(home, cwd);
		process.env.HOME = home;

		writeFileSync(
			join(cwd, 'mcp.json'),
			JSON.stringify({
				mcpServers: {
					broken: {
						type: 'http',
					},
				},
			}),
		);

		expect(() => load_mcp_config(cwd)).toThrow(
			'Invalid MCP server "broken": http transport requires a url',
		);
	});

	it('uses the expected global config path', () => {
		const home = tmp_dir();
		const cwd = tmp_dir();
		dirs.push(home, cwd);
		process.env.HOME = home;

		const global_path = join(home, '.pi', 'agent', 'mcp.json');
		mkdirSync(join(home, '.pi', 'agent'), { recursive: true });
		writeFileSync(
			global_path,
			JSON.stringify({
				mcpServers: {
					global: { command: 'npx' },
				},
			}),
		);

		expect(existsSync(global_path)).toBe(true);
		expect(load_mcp_config(cwd)).toEqual([
			{ name: 'global', transport: 'stdio', command: 'npx' },
		]);
	});
});
