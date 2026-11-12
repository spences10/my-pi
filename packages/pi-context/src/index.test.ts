import { make_command_context } from '../../../tools/test-sdk.js';
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	utimesSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
} from 'vite-plus/test';
import { temp_config, temp_db } from '../test/support.js';
import {
	capture_extension,
	hook_text,
	tool_result_event,
	tool_text,
} from '../test/tool-fixtures.js';
import context_sidecar, {
	get_context_store,
	is_context_sidecar_enabled,
	load_context_settings_config,
	set_context_sidecar_enabled,
} from './index.js';

let dirs: string[] = [];
const original_context_db = process.env.MY_PI_CONTEXT_DB;

const original_retention_days =
	process.env.MY_PI_CONTEXT_RETENTION_DAYS;

const original_purge_on_shutdown =
	process.env.MY_PI_CONTEXT_PURGE_ON_SHUTDOWN;

const original_max_mb = process.env.MY_PI_CONTEXT_MAX_MB;
const original_context_config = process.env.MY_PI_CONTEXT_CONFIG;

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

function fake_context(cwd: string, session_file: string) {
	return {
		cwd,
		sessionManager: {
			getSessionFile: () => session_file,
			getSessionId: () => session_file.replace(/\.jsonl$/, ''),
		},
	};
}

beforeEach(() => {
	process.env.MY_PI_CONTEXT_CONFIG = temp_config();
});

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

	if (original_context_config === undefined)
		delete process.env.MY_PI_CONTEXT_CONFIG;
	else process.env.MY_PI_CONTEXT_CONFIG = original_context_config;

	for (const dir of dirs)
		rmSync(dir, { recursive: true, force: true });
	dirs = [];
});

describe('context_sidecar extension', () => {
	it('registers lifecycle hooks, retrieval tools, and stats command', async () => {
		process.env.MY_PI_CONTEXT_DB = temp_db();
		const fake = capture_extension(context_sidecar);

		expect(is_context_sidecar_enabled()).toBe(true);
		expect([...fake.tools.keys()].sort()).toEqual([
			'context_export',
			'context_get',
			'context_list',
			'context_purge',
			'context_search',
			'context_stats',
		]);
		expect(fake.commands.has('context-stats')).toBe(true);
		expect(fake.hook_count('tool_result')).toBe(1);

		await fake.session_shutdown();
		expect(is_context_sidecar_enabled()).toBe(false);
		await fake.session_start({ cwd: '/tmp/project' });
		expect(is_context_sidecar_enabled()).toBe(true);
	});

	it('runs retention cleanup on session lifecycle without deleting fresh current-session data', async () => {
		process.env.MY_PI_CONTEXT_DB = temp_db();
		process.env.MY_PI_CONTEXT_RETENTION_DAYS = '1';
		process.env.MY_PI_CONTEXT_PURGE_ON_SHUTDOWN = 'true';
		const fake = capture_extension(context_sidecar);

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

		await fake.session_start(
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

		await fake.session_shutdown();
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

	it('saves context settings from the /context command', async () => {
		process.env.MY_PI_CONTEXT_DB = temp_db();
		process.env.MY_PI_CONTEXT_CONFIG = join(
			mkdtempSync(join(tmpdir(), 'pi-context-settings-')),
			'context.json',
		);
		dirs.push(
			process.env.MY_PI_CONTEXT_CONFIG.replace(
				/\/context\.json$/,
				'',
			),
		);
		const notifications: string[] = [];
		const fake = capture_extension(context_sidecar);

		await fake.commands.get('context')!.handler(
			'settings light',
			make_command_context({
				ui: {
					notify: (message: string) => {
						notifications.push(message);
					},
				},
			}),
		);

		expect(load_context_settings_config()).toMatchObject({
			preset: 'light',
			retention_days: 1,
			max_mb: 50,
		});
		expect(notifications[0]).toContain('Context settings saved');
	});

	it('stores and searches with session/project scope from extension context', async () => {
		const db_path = temp_db();
		process.env.MY_PI_CONTEXT_DB = db_path;
		const fake = capture_extension(context_sidecar);
		const project_a = fake_context('/repo-a', '/sessions/a.jsonl');
		const project_b = fake_context('/repo-b', '/sessions/b.jsonl');

		const a = await fake.tool_result(
			tool_result_event({
				toolName: 'bash',
				content: [
					{ type: 'text', text: large_output('scope-token-a') },
				],
			}),
			project_a,
		);

		await fake.tool_result(
			tool_result_event({
				toolName: 'bash',
				content: [
					{ type: 'text', text: large_output('scope-token-b') },
				],
			}),
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
				.get(source_id_from(hook_text(a)));

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

		expect(tool_text(scoped)).toContain('scope-token-a');
		expect(tool_text(scoped)).not.toContain('scope-token-b');

		const global = await fake.tools
			.get('context_search')!
			.execute(
				'call-2',
				{ query: 'scope-token', global: true },
				undefined,
				undefined,
				project_a,
			);

		expect(tool_text(global)).toContain('scope-token-a');
		expect(tool_text(global)).toContain('scope-token-b');

		const list = await fake.tools
			.get('context_list')!
			.execute(
				'call-3',
				{ limit: 5 },
				undefined,
				undefined,
				project_a,
			);

		expect(tool_text(list)).toContain('Project: /repo-a');
		expect(tool_text(list)).toContain('Session: /sessions/a.jsonl');
		expect(tool_text(list)).not.toContain('Project: /repo-b');
		expect(list.details).toMatchObject({ count: 1 });
	});

	it('replaces oversized text results and leaves small, recursive, and non-text results alone', async () => {
		process.env.MY_PI_CONTEXT_DB = temp_db();
		const fake = capture_extension(context_sidecar);
		expect(
			await fake.tool_result(
				tool_result_event({
					toolName: 'bash',
					content: [{ type: 'text', text: 'small output' }],
				}),
			),
		).toBeUndefined();

		for (const toolName of [
			'context_search',
			'context_get',
			'context_list',
			'context_stats',
			'context_purge',
		]) {
			expect(
				await fake.tool_result(
					tool_result_event({
						toolName,
						content: [
							{
								type: 'text',
								text: large_output(`skip-${toolName}`),
							},
						],
					}),
				),
			).toBeUndefined();
		}

		expect(
			await fake.tool_result(
				tool_result_event({
					toolName: 'bash',
					content: [
						{ type: 'image', data: 'ignored', mimeType: 'image/png' },
					],
				}),
			),
		).toBeUndefined();

		const replacement = await fake.tool_result(
			tool_result_event({
				toolName: 'bash',
				input: { command: 'generate large output' },
				content: [{ type: 'text', text: large_output('hook-token') }],
			}),
		);

		expect(hook_text(replacement)).toContain('[context-sidecar]');
		expect(hook_text(replacement)).toContain('context_search');
		const source_id = source_id_from(hook_text(replacement));
		expect(
			get_context_store().search('hook-token', { source_id }),
		).toHaveLength(1);
	});

	it('does not re-index an existing context-sidecar receipt', async () => {
		process.env.MY_PI_CONTEXT_DB = temp_db();
		const fake = capture_extension(context_sidecar);

		const stored = get_context_store().store({
			text: large_output('receipt-token'),
			tool_name: 'mcp__demo__large',
			force: true,
		});

		expect(
			await fake.tool_result(
				tool_result_event({
					toolName: 'mcp__demo__large',
					content: [{ type: 'text', text: stored!.receipt }],
				}),
			),
		).toBeUndefined();
		expect(get_context_store().list({ global: true })).toHaveLength(
			1,
		);
		expect(
			get_context_store().search('receipt-token', {
				global: true,
			}),
		).toHaveLength(1);
	});

	it('searches, retrieves, reports stats, purges, and notifies through registered tools', async () => {
		process.env.MY_PI_CONTEXT_DB = temp_db();
		const fake = capture_extension(context_sidecar);

		const replacement = await fake.tool_result(
			tool_result_event({
				toolName: 'bash',
				content: [{ type: 'text', text: large_output('tool-token') }],
			}),
		);

		const source_id = source_id_from(hook_text(replacement));

		const search = await fake.tools
			.get('context_search')!
			.execute('call-1', {
				query: 'tool-token',
				limit: 1,
			});

		expect(tool_text(search)).toContain('tool-token');
		expect(search.details).toMatchObject({ count: 1 });

		const list = await fake.tools
			.get('context_list')!
			.execute('call-list', { limit: 1 });

		expect(tool_text(list)).toContain(source_id);
		expect(tool_text(list)).toContain('Tool: bash');
		expect(list.details).toMatchObject({ count: 1 });

		const get = await fake.tools
			.get('context_get')!
			.execute('call-2', {
				source_id,
			});

		expect(tool_text(get)).toContain('tool-token');
		expect(get.details).toMatchObject({ count: 1 });

		const alias_get = await fake.tools
			.get('context_get')!
			.execute('call-2a', {
				source_id,
				chunk_id: '0001',
			});

		expect(tool_text(alias_get)).toContain('tool-token');
		expect(alias_get.details).toMatchObject({ count: 1 });

		const export_dir = mkdtempSync(
			join(tmpdir(), 'pi-context-export-'),
		);

		dirs.push(export_dir);

		const exported = await fake.tools
			.get('context_export')!
			.execute('call-export', {
				source_id,
				file_path: join(export_dir, 'export.txt'),
			});

		expect(tool_text(exported)).toContain('Exported 1 chunk(s)');
		expect(tool_text(exported)).toContain(
			join(export_dir, 'export.txt'),
		);
		expect(tool_text(exported)).not.toContain('tool-token');
		expect(
			readFileSync(join(export_dir, 'export.txt'), 'utf8'),
		).toContain('tool-token');
		expect(exported.details).toMatchObject({
			count: 1,
			exported: true,
			file_path: join(export_dir, 'export.txt'),
			verified: true,
		});

		const managed_export_dir = join(
			dirname(process.env.MY_PI_CONTEXT_DB!),
			'context-exports',
		);

		mkdirSync(managed_export_dir, { recursive: true });
		const stale_export = join(managed_export_dir, 'stale.txt');
		writeFileSync(stale_export, 'old export');
		const stale_date = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000);
		utimesSync(stale_export, stale_date, stale_date);

		const default_export = await fake.tools
			.get('context_export')!
			.execute('call-export-default', { source_id });

		const managed_file = join(managed_export_dir, `${source_id}.txt`);
		expect(tool_text(default_export)).toContain(managed_file);
		expect(readFileSync(managed_file, 'utf8')).toContain(
			'tool-token',
		);
		expect(default_export.details).toMatchObject({
			count: 1,
			exported: true,
			file_path: managed_file,
			verified: true,
		});
		expect(existsSync(stale_export)).toBe(false);

		const missing_chunk = await fake.tools
			.get('context_get')!
			.execute('call-2b', {
				source_id,
				chunk_id: 'missing',
			});

		expect(tool_text(missing_chunk)).toContain(
			'No chunk found for chunk_id "missing".',
		);
		expect(tool_text(missing_chunk)).toContain('Valid ordinals: 1');
		expect(tool_text(missing_chunk)).toContain('Try chunk_id:');

		const stats = await fake.tools
			.get('context_stats')!
			.execute('call-3', {});

		expect(tool_text(stats)).toContain('context-sidecar stats');
		expect(stats.details).toMatchObject({ sources: 1, chunks: 1 });

		get_context_store({
			project_path: '/other/project',
			session_id: '/sessions/other.jsonl',
		}).store({
			text: `${large_output('other-scope-token')}\n${'z '.repeat(100)}`,
			tool_name: 'bash',
			force: true,
			project_path: '/other/project',
			session_id: '/sessions/other.jsonl',
		});

		const scoped_stats = await fake.tools
			.get('context_stats')!
			.execute('call-3a', {});

		expect(scoped_stats.details).toMatchObject({
			sources: 1,
			global_sources: 2,
		});

		const global_stats = await fake.tools
			.get('context_stats')!
			.execute(
				'call-3b',
				{ global: true },
				undefined,
				undefined,
				fake_context('/tmp/project', '/sessions/current.jsonl'),
			);

		expect(tool_text(global_stats)).toContain('Scope: global');
		expect(global_stats.details).toMatchObject({
			sources: 2,
			global_sources: 2,
		});

		const notifications: string[] = [];
		await fake.commands.get('context-stats')!.handler(
			'',
			make_command_context({
				hasUI: false,
				ui: {
					notify(message, type) {
						notifications.push(`${type}:${message}`);
					},
				},
			}),
		);
		expect(notifications[0]).toContain('info:Enabled: true');
		expect(notifications[0]).toContain('Scope: global');

		const purge = await fake.tools
			.get('context_purge')!
			.execute('call-4', {
				source_id,
			});

		expect(tool_text(purge)).toContain(
			'Deleted 1 context source(s).',
		);
		expect(tool_text(purge)).toContain(`source_id=${source_id}`);
		expect(purge.details).toMatchObject({ deleted: 1, source_id });

		const empty = await fake.tools
			.get('context_get')!
			.execute('call-5', {
				source_id,
			});

		expect(tool_text(empty)).toContain(
			`Source ${source_id} was not found`,
		);
		expect(tool_text(empty)).toContain('expired');
	});
});
