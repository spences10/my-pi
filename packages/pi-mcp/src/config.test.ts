import { write_settings } from '@spences10/pi-settings';
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
	create_mcp_config_backup,
	get_project_mcp_config_info,
	list_mcp_config_backups,
	list_mcp_profiles,
	load_mcp_config,
	load_mcp_profile,
	restore_mcp_config_backup,
	save_mcp_profile,
	set_mcp_server_enabled,
} from './config.js';
import { ignored_project_mcp_config_path } from './config/paths.js';

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
	const original_agent_dir = process.env.PI_CODING_AGENT_DIR;
	const original_mcp_allowlist = process.env.MY_PI_MCP_ENV_ALLOWLIST;
	const original_test_token = process.env.MY_TEST_TOKEN;
	const original_secret_token = process.env.MY_SECRET_TOKEN;

	afterEach(() => {
		for (const dir of dirs.splice(0)) {
			rmSync(dir, { recursive: true, force: true });
		}
		if (original_home === undefined) {
			delete process.env.HOME;
		} else {
			process.env.HOME = original_home;
		}
		if (original_agent_dir === undefined) {
			delete process.env.PI_CODING_AGENT_DIR;
		} else {
			process.env.PI_CODING_AGENT_DIR = original_agent_dir;
		}
		if (original_mcp_allowlist === undefined) {
			delete process.env.MY_PI_MCP_ENV_ALLOWLIST;
		} else {
			process.env.MY_PI_MCP_ENV_ALLOWLIST = original_mcp_allowlist;
		}
		if (original_test_token === undefined) {
			delete process.env.MY_TEST_TOKEN;
		} else {
			process.env.MY_TEST_TOKEN = original_test_token;
		}
		if (original_secret_token === undefined) {
			delete process.env.MY_SECRET_TOKEN;
		} else {
			process.env.MY_SECRET_TOKEN = original_secret_token;
		}
	});

	it('uses PI_CODING_AGENT_DIR for global config files', () => {
		const agent_dir = tmp_dir();
		const home = tmp_dir();
		const cwd = tmp_dir();
		dirs.push(agent_dir, home, cwd);
		process.env.HOME = home;
		process.env.PI_CODING_AGENT_DIR = agent_dir;

		writeFileSync(
			join(agent_dir, 'mcp.json'),
			JSON.stringify({
				mcpServers: {
					global: { command: 'global-cmd' },
				},
			}),
		);
		mkdirSync(join(home, '.pi', 'agent'), { recursive: true });
		writeFileSync(
			join(home, '.pi', 'agent', 'mcp.json'),
			JSON.stringify({
				mcpServers: {
					wrong: { command: 'wrong-cmd' },
				},
			}),
		);

		expect(load_mcp_config(cwd)).toMatchObject([
			{ name: 'global', command: 'global-cmd' },
		]);
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

	it('falls back to .mcp.json when mcp.json is missing', () => {
		const home = tmp_dir();
		const cwd = tmp_dir();
		dirs.push(home, cwd);
		process.env.HOME = home;

		writeFileSync(
			join(cwd, '.mcp.json'),
			JSON.stringify({
				mcpServers: {
					hidden: { command: 'hidden-cmd' },
				},
			}),
		);

		expect(load_mcp_config(cwd)).toMatchObject([
			{ name: 'hidden', command: 'hidden-cmd' },
		]);
		expect(ignored_project_mcp_config_path(cwd)).toBeUndefined();
	});

	it('prefers mcp.json over .mcp.json and reports the ignored file', () => {
		const home = tmp_dir();
		const cwd = tmp_dir();
		dirs.push(home, cwd);
		process.env.HOME = home;

		writeFileSync(
			join(cwd, 'mcp.json'),
			JSON.stringify({
				mcpServers: {
					visible: { command: 'visible-cmd' },
				},
			}),
		);
		writeFileSync(
			join(cwd, '.mcp.json'),
			JSON.stringify({
				mcpServers: {
					hidden: { command: 'hidden-cmd' },
				},
			}),
		);

		expect(load_mcp_config(cwd)).toMatchObject([
			{ name: 'visible', command: 'visible-cmd' },
		]);
		expect(ignored_project_mcp_config_path(cwd)).toBe(
			join(cwd, '.mcp.json'),
		);
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

	it('expands allowlisted env vars in http headers', () => {
		const home = tmp_dir();
		const cwd = tmp_dir();
		dirs.push(home, cwd);
		process.env.HOME = home;
		process.env.MY_PI_MCP_ENV_ALLOWLIST = 'MY_TEST_TOKEN';
		process.env.MY_TEST_TOKEN = 'secret123';

		writeFileSync(
			join(cwd, 'mcp.json'),
			JSON.stringify({
				mcpServers: {
					remote: {
						type: 'http',
						url: 'https://example.com/mcp',
						headers: {
							Authorization: 'Bearer ${MY_TEST_TOKEN}',
							'X-Custom': 'static',
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
				headers: {
					Authorization: 'Bearer secret123',
					'X-Custom': 'static',
				},
			},
		]);
	});

	it('does not expand non-allowlisted env vars in http headers', () => {
		const home = tmp_dir();
		const cwd = tmp_dir();
		dirs.push(home, cwd);
		process.env.HOME = home;
		process.env.MY_SECRET_TOKEN = 'should-not-leak';

		writeFileSync(
			join(cwd, 'mcp.json'),
			JSON.stringify({
				mcpServers: {
					remote: {
						type: 'http',
						url: 'https://example.com/mcp',
						headers: {
							Authorization: 'Bearer ${MY_SECRET_TOKEN}',
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
				headers: { Authorization: 'Bearer ' },
			},
		]);
	});

	it('parses disabled flags and can persist toggles', () => {
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
						disabled: true,
					},
				},
			}),
		);

		expect(load_mcp_config(cwd)).toEqual([
			{
				name: 'local',
				transport: 'stdio',
				command: 'npx',
				disabled: true,
			},
		]);

		expect(set_mcp_server_enabled(cwd, 'local', true)).toBe(true);
		expect(load_mcp_config(cwd)).toEqual([
			{
				name: 'local',
				transport: 'stdio',
				command: 'npx',
				disabled: false,
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

	it('marks project MCP metadata untrusted when allowed once', () => {
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
					global: { command: 'global-cmd' },
				},
			}),
		);
		writeFileSync(
			join(cwd, 'mcp.json'),
			JSON.stringify({
				mcpServers: {
					project: { command: 'project-cmd' },
				},
			}),
		);

		expect(
			load_mcp_config(cwd, { project_metadata_trusted: false }),
		).toEqual([
			{
				name: 'global',
				transport: 'stdio',
				command: 'global-cmd',
			},
			{
				name: 'project',
				transport: 'stdio',
				command: 'project-cmd',
				metadata_trusted: false,
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

	it('filters servers by MCP activation policy', () => {
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
					org: { command: 'org-cmd' },
					repo: { command: 'repo-cmd' },
					other: { command: 'other-cmd' },
					unrestricted: { command: 'any-cmd' },
				},
			}),
		);
		write_settings({
			version: 1,
			mcp: {
				policy: {
					servers: {
						org: { activateWhen: { githubOrg: ['spences10'] } },
						repo: {
							activateWhen: { githubRepo: ['spences10/my-pi'] },
						},
						other: {
							activateWhen: { githubRepo: ['elsewhere/project'] },
						},
					},
				},
			},
		});
		writeFileSync(join(cwd, '.gitignore'), '');
		expect(() =>
			execFileSync('git', ['init'], { cwd, stdio: 'ignore' }),
		).not.toThrow();
		expect(() =>
			execFileSync(
				'git',
				[
					'remote',
					'add',
					'origin',
					'git@github.com:spences10/my-pi.git',
				],
				{ cwd, stdio: 'ignore' },
			),
		).not.toThrow();

		expect(load_mcp_config(cwd).map((config) => config.name)).toEqual(
			['org', 'repo', 'unrestricted'],
		);
	});

	it('matches cwdPrefix on path boundaries only', () => {
		const home = tmp_dir();
		const parent = tmp_dir();
		const trusted = join(parent, 'project');
		const descendant = join(trusted, 'nested');
		const dotted_descendant = join(trusted, '..cache');
		const sibling = join(parent, 'project-evil');
		dirs.push(home, parent);
		process.env.HOME = home;
		mkdirSync(descendant, { recursive: true });
		mkdirSync(dotted_descendant, { recursive: true });
		mkdirSync(sibling, { recursive: true });

		const global_dir = join(home, '.pi', 'agent');
		mkdirSync(global_dir, { recursive: true });
		writeFileSync(
			join(global_dir, 'mcp.json'),
			JSON.stringify({
				mcpServers: { scoped: { command: 'scoped-cmd' } },
			}),
		);
		write_settings({
			version: 1,
			mcp: {
				policy: {
					servers: {
						scoped: { activateWhen: { cwdPrefix: trusted } },
					},
				},
			},
		});

		expect(load_mcp_config(trusted)).toHaveLength(1);
		expect(load_mcp_config(descendant)).toHaveLength(1);
		expect(load_mcp_config(dotted_descendant)).toHaveLength(1);
		expect(load_mcp_config(sibling)).toEqual([]);
	});

	it('does not let project MCP policy widen global activation', () => {
		const home = tmp_dir();
		const cwd = tmp_dir();
		dirs.push(home, cwd);
		process.env.HOME = home;

		const global_dir = join(home, '.pi', 'agent');
		mkdirSync(global_dir, { recursive: true });
		mkdirSync(join(cwd, '.pi'), { recursive: true });
		writeFileSync(
			join(global_dir, 'mcp.json'),
			JSON.stringify({ mcpServers: { scoped: { command: 'cmd' } } }),
		);
		write_settings({
			version: 1,
			mcp: {
				policy: {
					servers: {
						scoped: {
							activateWhen: { githubRepo: ['elsewhere/project'] },
						},
					},
				},
			},
		});
		writeFileSync(
			join(cwd, '.pi', 'mcp-policy.json'),
			JSON.stringify({ servers: { scoped: {} } }),
		);

		expect(load_mcp_config(cwd)).toEqual([]);
	});

	it('lets project MCP policy further restrict global activation', () => {
		const home = tmp_dir();
		const cwd = tmp_dir();
		dirs.push(home, cwd);
		process.env.HOME = home;

		const global_dir = join(home, '.pi', 'agent');
		mkdirSync(global_dir, { recursive: true });
		mkdirSync(join(cwd, '.pi'), { recursive: true });
		writeFileSync(
			join(global_dir, 'mcp.json'),
			JSON.stringify({ mcpServers: { scoped: { command: 'cmd' } } }),
		);
		write_settings({
			version: 1,
			mcp: {
				policy: {
					servers: {
						scoped: { activateWhen: { cwdPrefix: cwd } },
					},
				},
			},
		});
		writeFileSync(
			join(cwd, '.pi', 'mcp-policy.json'),
			JSON.stringify({
				servers: {
					scoped: {
						activateWhen: { githubRepo: ['elsewhere/project'] },
					},
				},
			}),
		);

		expect(load_mcp_config(cwd)).toEqual([]);
		expect(load_mcp_config(cwd, { include_project: false })).toEqual([
			{ name: 'scoped', transport: 'stdio', command: 'cmd' },
		]);
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

	it('backs up and restores global and project MCP configs', () => {
		const home = tmp_dir();
		const cwd = tmp_dir();
		dirs.push(home, cwd);
		process.env.HOME = home;

		const global_path = join(home, '.pi', 'agent', 'mcp.json');
		mkdirSync(join(home, '.pi', 'agent'), { recursive: true });
		writeFileSync(
			global_path,
			JSON.stringify({ mcpServers: { global: { command: 'g' } } }),
		);
		writeFileSync(
			join(cwd, 'mcp.json'),
			JSON.stringify({ mcpServers: { project: { command: 'p' } } }),
		);

		const backup = create_mcp_config_backup(cwd);
		expect(backup.global_server_count).toBe(1);
		expect(backup.project_server_count).toBe(1);
		expect(list_mcp_config_backups()).toHaveLength(1);

		writeFileSync(
			global_path,
			JSON.stringify({ mcpServers: { changed: { command: 'c' } } }),
		);
		rmSync(join(cwd, 'mcp.json'));

		restore_mcp_config_backup(cwd, backup.path);

		expect(load_mcp_config(cwd)).toEqual([
			{ name: 'global', transport: 'stdio', command: 'g' },
			{ name: 'project', transport: 'stdio', command: 'p' },
		]);
	});

	it('saves and loads MCP profiles into the selected scope', () => {
		const home = tmp_dir();
		const cwd = tmp_dir();
		dirs.push(home, cwd);
		process.env.HOME = home;

		const global_path = join(home, '.pi', 'agent', 'mcp.json');
		mkdirSync(join(home, '.pi', 'agent'), { recursive: true });
		writeFileSync(
			global_path,
			JSON.stringify({ mcpServers: { global: { command: 'g' } } }),
		);
		writeFileSync(
			join(cwd, 'mcp.json'),
			JSON.stringify({ mcpServers: { project: { command: 'p' } } }),
		);

		const profile = save_mcp_profile(cwd, 'work');
		expect(profile.server_count).toBe(2);
		expect(list_mcp_profiles()).toMatchObject([
			{ name: 'work', server_count: 2 },
		]);

		writeFileSync(global_path, JSON.stringify({ mcpServers: {} }));
		load_mcp_profile(cwd, 'work', 'global');

		const restored = JSON.parse(readFileSync(global_path, 'utf-8'));
		expect(Object.keys(restored.mcpServers)).toEqual([
			'global',
			'project',
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
