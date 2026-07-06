import { EventEmitter } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { TeamDatabase } from './db/index.js';
import {
	DefaultHeadlessSessionRunner,
	build_headless_session_args,
	create_headless_session_env,
	headless_session_id,
	normalize_headless_alias,
} from './headless-runner.js';

const dirs: string[] = [];

async function tmp_db(): Promise<TeamDatabase> {
	const dir = mkdtempSync(join(tmpdir(), 'pi-headless-runner-'));
	dirs.push(dir);
	return TeamDatabase.open(join(dir, 'coordination.db'));
}

afterEach(() => {
	for (const dir of dirs)
		rmSync(dir, { recursive: true, force: true });
	dirs.length = 0;
});

function fake_child(pid = 1234) {
	const child = new EventEmitter() as any;
	child.pid = pid;
	child.stdin = { unref: vi.fn() };
	child.unref = vi.fn();
	return child;
}

describe('headless session runner', () => {
	it('normalizes aliases and builds deterministic session ids/args', () => {
		expect(normalize_headless_alias('Worker One!')).toBe(
			'worker-one',
		);
		expect(
			headless_session_id('parent/session', 'Worker One!'),
		).toContain('parent-session-worker-one');
		expect(
			build_headless_session_args({
				session_id: 'session-1',
				extension_path: '/ext.js',
				model: 'sonnet',
				thinking: 'low',
			}),
		).toEqual([
			'--mode',
			'rpc',
			'--session-id',
			'session-1',
			'-e',
			'/ext.js',
			'--name',
			'session-1',
			'--model',
			'sonnet',
			'--thinking',
			'low',
		]);
	});

	it('creates a restricted team-mode child environment', () => {
		const env = create_headless_session_env(
			{
				alias: 'worker',
				cwd: '/repo',
				parent_session_id: 'lead',
				coordination_db_path: '/coordination.db',
				team_root: '/teams',
				extension_path: '/ext.js',
				group_id: 'group-1',
				intent: 'research',
				thinking: 'medium',
			},
			'session-1',
			{
				PATH: '/bin',
				HOME: '/home/test',
				ANTHROPIC_API_KEY: 'secret',
				DATABASE_URL: 'secret',
			},
		);

		expect(env.PATH).toBe('/bin');
		expect(env.MY_PI_TEAM_MEMBER).toBe('worker');
		expect(env.MY_PI_TEAM_ROLE).toBe('teammate');
		expect(env.MY_PI_TEAM_PARENT_SESSION_ID).toBe('lead');
		expect(env.MY_PI_TEAM_SESSION_ALIAS).toBe('worker');
		expect(env.MY_PI_TEAM_SESSION_INTENT).toBe('research');
		expect(env.MY_PI_TEAM_LAUNCH_MODE).toBe('headless');
		expect(env.MY_PI_ACTIVE_TEAM_ID).toBe('group-1');
		expect(env.ANTHROPIC_API_KEY).toBeUndefined();
		expect(env.DATABASE_URL).toBeUndefined();
	});

	it('spawns detached and registers parent/session metadata', async () => {
		const db = await tmp_db();
		try {
			const child = fake_child(4242);
			const spawn = vi.fn(() => child);
			const runner = new DefaultHeadlessSessionRunner(db, {
				spawn: spawn as any,
				source_env: { PATH: '/bin' },
				sleep: async () => {
					const pending = db
						.list_sessions({ include_offline: true })
						.find((session) => session.session_alias === 'worker');
					if (pending)
						db.register_session({
							...pending,
							metadata: {
								...pending.metadata,
								registered_by: 'child',
							},
						});
				},
				process_identity_verifier: {
					capture: (pid) => ({
						pid,
						platform: 'linux',
						captured_at: 'now',
						start_key: 'start',
					}),
					is_alive: () => true,
					kill: vi.fn(),
				},
			});

			const opened = await runner.open_or_resume({
				alias: 'Worker',
				cwd: '/repo',
				parent_session_id: 'lead',
				coordination_db_path: '/coordination.db',
				team_root: '/teams',
				extension_path: '/ext.js',
				group_id: 'group-1',
				message: 'start here',
				pi_command: 'pi',
			});

			expect(spawn).toHaveBeenCalledWith(
				'pi',
				expect.arrayContaining(['--mode', 'rpc', '-e', '/ext.js']),
				expect.objectContaining({
					cwd: '/repo',
					detached: true,
					shell: false,
					stdio: ['pipe', 'ignore', 'ignore'],
				}),
			);
			expect(child.unref).toHaveBeenCalled();
			expect(child.stdin.unref).toHaveBeenCalled();
			expect(opened.session.parent_session_id).toBe('lead');
			expect(opened.session.session_alias).toBe('worker');
			expect(opened.session.metadata.group_id).toBe('group-1');
			expect(opened.session.metadata.registered_by).toBe('child');
			expect(opened.session.metadata.process_identity).toMatchObject({
				pid: 4242,
			});
		} finally {
			db.close();
		}
	});

	it('rejects when child never self-registers', async () => {
		const db = await tmp_db();
		try {
			const runner = new DefaultHeadlessSessionRunner(db, {
				spawn: vi.fn(() => fake_child()) as any,
			});

			await expect(
				runner.open_or_resume({
					alias: 'worker',
					cwd: '/repo',
					parent_session_id: 'lead',
					coordination_db_path: '/coordination.db',
					team_root: '/teams',
					extension_path: '/ext.js',
					timeout_ms: 0,
				}),
			).rejects.toThrow(/self-register/);
			expect(
				db.list_sessions({ include_offline: true })[0]?.status,
			).toBe('offline');
		} finally {
			db.close();
		}
	});

	it('rejects spawn errors before registration', async () => {
		const db = await tmp_db();
		try {
			const child = fake_child();
			const runner = new DefaultHeadlessSessionRunner(db, {
				spawn: vi.fn(() => child) as any,
				sleep: async () => {
					child.emit('error', new Error('missing pi'));
				},
			});

			await expect(
				runner.open_or_resume({
					alias: 'worker',
					cwd: '/repo',
					parent_session_id: 'lead',
					coordination_db_path: '/coordination.db',
					team_root: '/teams',
					extension_path: '/ext.js',
				}),
			).rejects.toThrow(/missing pi/);
		} finally {
			db.close();
		}
	});

	it('rejects early child exit before registration', async () => {
		const db = await tmp_db();
		try {
			const child = fake_child();
			const runner = new DefaultHeadlessSessionRunner(db, {
				spawn: vi.fn(() => child) as any,
				sleep: async () => {
					child.emit('exit', 1, null);
				},
			});

			await expect(
				runner.open_or_resume({
					alias: 'worker',
					cwd: '/repo',
					parent_session_id: 'lead',
					coordination_db_path: '/coordination.db',
					team_root: '/teams',
					extension_path: '/ext.js',
				}),
			).rejects.toThrow(/exited before registration/);
		} finally {
			db.close();
		}
	});

	it('rejects if child exits after self-registration before return', async () => {
		const db = await tmp_db();
		try {
			const child = fake_child(333);
			const runner = new DefaultHeadlessSessionRunner(db, {
				spawn: vi.fn(() => child) as any,
				sleep: async () => {
					const pending = db
						.list_sessions({ include_offline: true })
						.find((session) => session.session_alias === 'worker');
					if (pending)
						db.register_session({
							...pending,
							metadata: {
								...pending.metadata,
								registered_by: 'child',
							},
						});
					child.emit('exit', 1, null);
				},
			});

			await expect(
				runner.open_or_resume({
					alias: 'worker',
					cwd: '/repo',
					parent_session_id: 'lead',
					coordination_db_path: '/coordination.db',
					team_root: '/teams',
					extension_path: '/ext.js',
				}),
			).rejects.toThrow(/exited before registration/);
			expect(
				db.list_sessions({ include_offline: true })[0]?.status,
			).toBe('offline');
		} finally {
			db.close();
		}
	});

	it('reopens an offline alias with its previous session target', async () => {
		const db = await tmp_db();
		try {
			db.register_session({
				session_id: 'existing',
				session_file: '/sessions/existing.jsonl',
				cwd: '/repo',
				status: 'offline',
				parent_session_id: 'lead',
				session_alias: 'worker',
			});
			const child = fake_child(222);
			const spawn = vi.fn((..._args: any[]) => child);
			const runner = new DefaultHeadlessSessionRunner(db, {
				spawn: spawn as any,
				sleep: async () => {
					const pending = db.get_session('existing');
					if (pending)
						db.register_session({
							...pending,
							metadata: {
								...pending.metadata,
								registered_by: 'child',
							},
						});
				},
			});

			const opened = await runner.open_or_resume({
				alias: 'worker',
				cwd: '/repo',
				parent_session_id: 'lead',
				coordination_db_path: '/coordination.db',
				team_root: '/teams',
				extension_path: '/ext.js',
			});

			expect(opened.session.session_id).toBe('existing');
			expect(spawn.mock.calls[0]?.[1]).toContain('--session');
			expect(spawn.mock.calls[0]?.[1]).toContain(
				'/sessions/existing.jsonl',
			);
		} finally {
			db.close();
		}
	});

	it('resumes a verified live alias instead of spawning', async () => {
		const db = await tmp_db();
		try {
			db.register_session({
				session_id: 'existing',
				cwd: '/repo',
				pid: 123,
				parent_session_id: 'lead',
				session_alias: 'worker',
				metadata: {
					process_identity: {
						pid: 123,
						platform: 'linux',
						captured_at: 'then',
						start_key: 'same',
					},
				},
			});
			const spawn = vi.fn(() => fake_child());
			const runner = new DefaultHeadlessSessionRunner(db, {
				spawn: spawn as any,
				process_identity_verifier: {
					capture: (pid) => ({
						pid,
						platform: 'linux',
						captured_at: 'now',
						start_key: 'same',
					}),
					is_alive: () => true,
					kill: vi.fn(),
				},
			});

			const opened = await runner.open_or_resume({
				alias: 'worker',
				cwd: '/repo',
				parent_session_id: 'lead',
				coordination_db_path: '/coordination.db',
				team_root: '/teams',
				extension_path: '/ext.js',
			});

			expect(opened.resumed).toBe(true);
			expect(opened.session.session_id).toBe('existing');
			expect(spawn).not.toHaveBeenCalled();
		} finally {
			db.close();
		}
	});
});
