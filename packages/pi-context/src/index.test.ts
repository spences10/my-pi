import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { afterEach, describe, expect, it } from 'vitest';
import context_sidecar, {
	get_context_store,
	is_context_sidecar_enabled,
	set_context_sidecar_enabled,
} from './index.js';

type FakeContext = {
	cwd: string;
	sessionManager?: {
		getSessionFile?: () => string | undefined;
		getSessionId?: () => string | undefined;
	};
};

type HookHandler = (
	event: Record<string, unknown>,
	ctx?: FakeContext,
) => Promise<unknown>;

type ToolResult = {
	content: Array<{ type: string; text: string }>;
	details?: unknown;
};

type RegisteredTool = {
	name: string;
	execute: (
		tool_call_id: string,
		params: Record<string, unknown>,
		signal?: AbortSignal,
		on_update?: unknown,
		ctx?: FakeContext,
	) => ToolResult | Promise<ToolResult>;
};

type RegisteredCommand = {
	handler: (args: string[], ctx: CommandContext) => Promise<void>;
};

type CommandContext = {
	ui: { notify: (message: string, type: string) => void };
};

let dirs: string[] = [];
const original_context_db = process.env.MY_PI_CONTEXT_DB;
const original_retention_days =
	process.env.MY_PI_CONTEXT_RETENTION_DAYS;
const original_purge_on_shutdown =
	process.env.MY_PI_CONTEXT_PURGE_ON_SHUTDOWN;
const original_max_mb = process.env.MY_PI_CONTEXT_MAX_MB;

function temp_db(): string {
	const dir = mkdtempSync(join(tmpdir(), 'pi-context-ext-'));
	dirs.push(dir);
	return join(dir, 'context.db');
}

function create_fake_pi(): {
	pi: ExtensionAPI;
	hooks: Map<string, HookHandler[]>;
	tools: Map<string, RegisteredTool>;
	commands: Map<string, RegisteredCommand>;
} {
	const hooks = new Map<string, HookHandler[]>();
	const tools = new Map<string, RegisteredTool>();
	const commands = new Map<string, RegisteredCommand>();
	const pi = {
		on(name: string, handler: HookHandler) {
			hooks.set(name, [...(hooks.get(name) ?? []), handler]);
		},
		registerTool(tool: unknown) {
			const registered = tool as RegisteredTool;
			tools.set(registered.name, registered);
		},
		registerCommand(name: string, command: unknown) {
			commands.set(name, command as RegisteredCommand);
		},
	} as unknown as ExtensionAPI;
	return { pi, hooks, tools, commands };
}

function large_output(token = 'needle-token'): string {
	return Array.from({ length: 340 }, (_value, index) =>
		index === 330 ? `${token} at line ${index}` : `line ${index}`,
	).join('\n');
}

function source_id_from(text: string): string {
	const match = text.match(/Source: (ctx_[^\n]+)/);
	expect(match).not.toBeNull();
	return match![1];
}

function fake_context(
	cwd: string,
	session_file?: string,
): FakeContext {
	return {
		cwd,
		sessionManager: {
			getSessionFile: () => session_file,
			getSessionId: () => session_file?.replace(/\.jsonl$/, ''),
		},
	};
}

afterEach(() => {
	set_context_sidecar_enabled(false);
	if (original_context_db === undefined)
		delete process.env.MY_PI_CONTEXT_DB;
	else process.env.MY_PI_CONTEXT_DB = original_context_db;
	if (original_retention_days === undefined)
		delete process.env.MY_PI_CONTEXT_RETENTION_DAYS;
	else
		process.env.MY_PI_CONTEXT_RETENTION_DAYS =
			original_retention_days;
	if (original_purge_on_shutdown === undefined)
		delete process.env.MY_PI_CONTEXT_PURGE_ON_SHUTDOWN;
	else
		process.env.MY_PI_CONTEXT_PURGE_ON_SHUTDOWN =
			original_purge_on_shutdown;
	if (original_max_mb === undefined)
		delete process.env.MY_PI_CONTEXT_MAX_MB;
	else process.env.MY_PI_CONTEXT_MAX_MB = original_max_mb;
	for (const dir of dirs)
		rmSync(dir, { recursive: true, force: true });
	dirs = [];
});

describe('context_sidecar extension', () => {
	it('registers lifecycle hooks, retrieval tools, and stats command', async () => {
		process.env.MY_PI_CONTEXT_DB = temp_db();
		const fake = create_fake_pi();

		context_sidecar(fake.pi);

		expect(is_context_sidecar_enabled()).toBe(true);
		expect([...fake.tools.keys()].sort()).toEqual([
			'context_get',
			'context_list',
			'context_purge',
			'context_search',
			'context_stats',
		]);
		expect(fake.commands.has('context-stats')).toBe(true);
		expect(fake.hooks.get('tool_result')).toHaveLength(1);

		await fake.hooks.get('session_shutdown')![0]({});
		expect(is_context_sidecar_enabled()).toBe(false);
		await fake.hooks.get('session_start')![0](
			{},
			{ cwd: '/tmp/project' },
		);
		expect(is_context_sidecar_enabled()).toBe(true);
	});

	it('runs retention cleanup on session lifecycle without deleting fresh current-session data', async () => {
		process.env.MY_PI_CONTEXT_DB = temp_db();
		process.env.MY_PI_CONTEXT_RETENTION_DAYS = '1';
		process.env.MY_PI_CONTEXT_PURGE_ON_SHUTDOWN = 'true';
		const fake = create_fake_pi();
		context_sidecar(fake.pi);
		const stale = get_context_store().store({
			text: `stale-lifecycle-token\n${'a '.repeat(100)}`,
			tool_name: 'bash',
			force: true,
		});
		const fresh = get_context_store().store({
			text: `fresh-lifecycle-token\n${'b '.repeat(100)}`,
			tool_name: 'bash',
			force: true,
			project_path: '/repo',
			session_id: '/sessions/current.jsonl',
		});
		const db = new DatabaseSync(get_context_store().db_path, {
			enableForeignKeyConstraints: true,
		});
		try {
			db.prepare(
				'UPDATE context_sources SET created_at = ? WHERE id = ?',
			).run(Date.now() - 3 * 24 * 60 * 60 * 1000, stale!.source_id);
		} finally {
			db.close();
		}

		await fake.hooks.get('session_start')![0](
			{},
			fake_context('/repo', '/sessions/current.jsonl'),
		);
		expect(
			get_context_store().get(stale!.source_id, undefined, {
				global: true,
			}),
		).toEqual([]);
		expect(
			get_context_store().get(fresh!.source_id, undefined, {
				global: true,
			}),
		).toHaveLength(fresh!.chunk_count);

		await fake.hooks.get('session_shutdown')![0]({});
		expect(is_context_sidecar_enabled()).toBe(false);
		set_context_sidecar_enabled(true, {
			db_path: process.env.MY_PI_CONTEXT_DB,
		});
		expect(
			get_context_store().get(fresh!.source_id, undefined, {
				global: true,
			}),
		).toHaveLength(fresh!.chunk_count);
	});

	it('stores and searches with session/project scope from extension context', async () => {
		const db_path = temp_db();
		process.env.MY_PI_CONTEXT_DB = db_path;
		const fake = create_fake_pi();
		context_sidecar(fake.pi);
		const tool_result = fake.hooks.get('tool_result')![0];
		const project_a = fake_context('/repo-a', '/sessions/a.jsonl');
		const project_b = fake_context('/repo-b', '/sessions/b.jsonl');

		const a = (await tool_result(
			{
				toolName: 'bash',
				content: [
					{ type: 'text', text: large_output('scope-token-a') },
				],
			},
			project_a,
		)) as ToolResult;
		await tool_result(
			{
				toolName: 'bash',
				content: [
					{ type: 'text', text: large_output('scope-token-b') },
				],
			},
			project_b,
		);

		const db = new DatabaseSync(db_path, {
			enableForeignKeyConstraints: true,
		});
		try {
			const row = db
				.prepare(
					'SELECT session_id, project_path FROM context_sources WHERE id = ?',
				)
				.get(source_id_from(a.content[0].text));
			expect(row).toMatchObject({
				session_id: '/sessions/a.jsonl',
				project_path: '/repo-a',
			});
		} finally {
			db.close();
		}

		const scoped = await fake.tools
			.get('context_search')!
			.execute(
				'call-1',
				{ query: 'scope-token', limit: 5 },
				undefined,
				undefined,
				project_a,
			);
		expect(scoped.content[0].text).toContain('scope-token-a');
		expect(scoped.content[0].text).not.toContain('scope-token-b');

		const global = await fake.tools
			.get('context_search')!
			.execute(
				'call-2',
				{ query: 'scope-token', global: true },
				undefined,
				undefined,
				project_a,
			);
		expect(global.content[0].text).toContain('scope-token-a');
		expect(global.content[0].text).toContain('scope-token-b');

		const list = await fake.tools
			.get('context_list')!
			.execute(
				'call-3',
				{ limit: 5 },
				undefined,
				undefined,
				project_a,
			);
		expect(list.content[0].text).toContain('Project: /repo-a');
		expect(list.content[0].text).toContain(
			'Session: /sessions/a.jsonl',
		);
		expect(list.content[0].text).not.toContain('Project: /repo-b');
		expect(list.details).toMatchObject({ count: 1 });
	});

	it('replaces oversized text tool results and leaves small, skipped, and non-text results alone', async () => {
		process.env.MY_PI_CONTEXT_DB = temp_db();
		const fake = create_fake_pi();
		context_sidecar(fake.pi);
		const tool_result = fake.hooks.get('tool_result')![0];

		expect(
			await tool_result({
				toolName: 'bash',
				content: [{ type: 'text', text: 'small output' }],
			}),
		).toBeUndefined();
		for (const toolName of [
			'context_search',
			'context_get',
			'context_list',
			'context_stats',
			'context_purge',
			'team',
		]) {
			expect(
				await tool_result({
					toolName,
					content: [
						{ type: 'text', text: large_output(`skip-${toolName}`) },
					],
				}),
			).toBeUndefined();
		}
		expect(
			await tool_result({
				toolName: 'bash',
				content: [{ type: 'image', data: 'ignored' }],
			}),
		).toBeUndefined();

		const replacement = (await tool_result({
			toolName: 'bash',
			input: { command: 'generate large output' },
			content: [{ type: 'text', text: large_output('hook-token') }],
		})) as ToolResult;

		expect(replacement.content[0].text).toContain(
			'[context-sidecar]',
		);
		expect(replacement.content[0].text).toContain('context_search');
		const source_id = source_id_from(replacement.content[0].text);
		expect(
			get_context_store().search('hook-token', { source_id }),
		).toHaveLength(1);
	});

	it('does not re-index an existing context-sidecar receipt such as direct MCP storage', async () => {
		process.env.MY_PI_CONTEXT_DB = temp_db();
		const fake = create_fake_pi();
		context_sidecar(fake.pi);
		const stored = get_context_store().store({
			text: large_output('mcp-direct-token'),
			tool_name: 'mcp__demo__large',
			force: true,
		});
		const tool_result = fake.hooks.get('tool_result')![0];

		expect(
			await tool_result({
				toolName: 'mcp__demo__large',
				content: [{ type: 'text', text: stored!.receipt }],
			}),
		).toBeUndefined();
		expect(get_context_store().list({ global: true })).toHaveLength(
			1,
		);
		expect(
			get_context_store().search('mcp-direct-token', {
				global: true,
			}),
		).toHaveLength(1);
	});

	it('searches, retrieves, reports stats, purges, and notifies through registered tools', async () => {
		process.env.MY_PI_CONTEXT_DB = temp_db();
		const fake = create_fake_pi();
		context_sidecar(fake.pi);
		const tool_result = fake.hooks.get('tool_result')![0];
		const replacement = (await tool_result({
			toolName: 'bash',
			content: [{ type: 'text', text: large_output('tool-token') }],
		})) as ToolResult;
		const source_id = source_id_from(replacement.content[0].text);

		const search = await fake.tools
			.get('context_search')!
			.execute('call-1', {
				query: 'tool-token',
				limit: 1,
			});
		expect(search.content[0].text).toContain('tool-token');
		expect(search.details).toMatchObject({ count: 1 });

		const list = await fake.tools
			.get('context_list')!
			.execute('call-list', { limit: 1 });
		expect(list.content[0].text).toContain(source_id);
		expect(list.content[0].text).toContain('Tool: bash');
		expect(list.details).toMatchObject({ count: 1 });

		const get = await fake.tools
			.get('context_get')!
			.execute('call-2', {
				source_id,
			});
		expect(get.content[0].text).toContain('tool-token');
		expect(get.details).toMatchObject({ count: 1 });

		const stats = await fake.tools
			.get('context_stats')!
			.execute('call-3', {});
		expect(stats.content[0].text).toContain('context-sidecar stats');
		expect(stats.details).toMatchObject({ sources: 1, chunks: 1 });

		const notifications: string[] = [];
		await fake.commands.get('context-stats')!.handler([], {
			ui: {
				notify(message: string, type: string) {
					notifications.push(`${type}:${message}`);
				},
			},
		});
		expect(notifications[0]).toContain(
			'info:## context-sidecar stats',
		);

		const purge = await fake.tools
			.get('context_purge')!
			.execute('call-4', {
				source_id,
			});
		expect(purge.content[0].text).toContain(
			'Deleted 1 context source(s).',
		);
		expect(purge.content[0].text).toContain(`source_id=${source_id}`);
		expect(purge.details).toMatchObject({ deleted: 1, source_id });

		const empty = await fake.tools
			.get('context_get')!
			.execute('call-5', {
				source_id,
			});
		expect(empty.content[0].text).toBe('No chunks found.');
	});
});
