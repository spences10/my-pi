import {
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import mcp, { should_wait_for_mcp_connections } from './index.js';

const dirs: string[] = [];
const original_home = process.env.HOME;
const original_project_config = process.env.MY_PI_MCP_PROJECT_CONFIG;

afterEach(() => {
	for (const dir of dirs.splice(0)) {
		rmSync(dir, { recursive: true, force: true });
	}
	if (original_home === undefined) delete process.env.HOME;
	else process.env.HOME = original_home;
	if (original_project_config === undefined) {
		delete process.env.MY_PI_MCP_PROJECT_CONFIG;
	} else {
		process.env.MY_PI_MCP_PROJECT_CONFIG = original_project_config;
	}
	vi.restoreAllMocks();
});

function tmp_dir(): string {
	const dir = mkdtempSync(join(tmpdir(), 'my-pi-mcp-index-'));
	dirs.push(dir);
	return dir;
}

function create_test_pi() {
	const commands = new Map<string, any>();
	const pi = {
		on: vi.fn(),
		registerTool: vi.fn(),
		registerCommand: vi.fn((name: string, command: any) => {
			commands.set(name, command);
		}),
		getActiveTools: vi.fn(() => []),
		setActiveTools: vi.fn(),
	};
	return { pi: pi as any, commands };
}

function write_mcp_config(
	dir: string,
	server_name: string,
	command: string,
) {
	writeFileSync(
		join(dir, 'mcp.json'),
		JSON.stringify({
			mcpServers: {
				[server_name]: { command },
			},
		}),
	);
}

async function run_mcp_list(cwd: string): Promise<string> {
	const { pi, commands } = create_test_pi();
	const notify = vi.fn();
	await mcp(pi);
	await commands.get('mcp').handler('list', {
		cwd,
		has_ui: false,
		ui: { notify },
	});
	return notify.mock.calls.map((call) => call[0]).join('\n');
}

describe('should_wait_for_mcp_connections', () => {
	it('waits when selected tools are unavailable', () => {
		expect(
			should_wait_for_mcp_connections({
				systemPromptOptions: {},
			} as any),
		).toBe(true);
	});

	it('waits when an MCP tool is selected', () => {
		expect(
			should_wait_for_mcp_connections({
				systemPromptOptions: {
					selectedTools: ['read', 'mcp__demo__ping'],
				},
			} as any),
		).toBe(true);
	});

	it('skips blocking when no MCP tools are selected', () => {
		expect(
			should_wait_for_mcp_connections({
				systemPromptOptions: { selectedTools: ['read', 'bash'] },
			} as any),
		).toBe(false);
	});
});

describe('MCP project config trust decisions', () => {
	it('skips project MCP config when env policy is skip', async () => {
		const home = tmp_dir();
		const cwd = tmp_dir();
		process.env.HOME = home;
		process.env.MY_PI_MCP_PROJECT_CONFIG = 'skip';

		const global_dir = join(home, '.pi', 'agent');
		mkdirSync(global_dir, { recursive: true });
		write_mcp_config(global_dir, 'shared', 'global-cmd');
		write_mcp_config(cwd, 'project', 'project-cmd');

		const message = await run_mcp_list(cwd);

		expect(message).toContain('shared');
		expect(message).not.toContain('project');
	});

	it('allows project MCP config once with untrusted metadata', async () => {
		const home = tmp_dir();
		const cwd = tmp_dir();
		process.env.HOME = home;
		process.env.MY_PI_MCP_PROJECT_CONFIG = 'allow';

		write_mcp_config(cwd, 'project', 'project-cmd');

		const message = await run_mcp_list(cwd);

		expect(message).toContain('project');
		expect(message).toContain('untrusted metadata suppressed');
	});
});
