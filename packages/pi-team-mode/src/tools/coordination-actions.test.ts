import { SessionManager } from '@earendil-works/pi-coding-agent';
import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	vi,
} from 'vitest';
import { TeamDatabase } from '../db/index.js';
import { TEAM_RUNTIME_ENV } from '../visible-sessions.js';
import { execute_coordination_action } from './coordination-actions.js';

const dirs: string[] = [];
const original_runtime = process.env[TEAM_RUNTIME_ENV];

async function tmp_db(): Promise<TeamDatabase> {
	const dir = mkdtempSync(
		join(tmpdir(), 'pi-team-coordination-actions-'),
	);
	dirs.push(dir);
	return TeamDatabase.open(join(dir, 'coordination.db'));
}

beforeEach(() => {
	delete process.env[TEAM_RUNTIME_ENV];
});

afterEach(() => {
	if (original_runtime === undefined) delete process.env[TEAM_RUNTIME_ENV];
	else process.env[TEAM_RUNTIME_ENV] = original_runtime;
	for (const dir of dirs)
		rmSync(dir, { recursive: true, force: true });
	dirs.length = 0;
});

describe('coordination actions', () => {
	it('prints full session ids when session_list mode is full', async () => {
		const db = await tmp_db();
		try {
			db.register_session({
				session_id: '019f0f71-967e-7aed-853c-94ac29fbe7b6',
				cwd: '/repo',
			});

			const result = await execute_coordination_action(
				{ action: 'session_list', mode: 'full' },
				{
					ctx: { cwd: '/repo' } as any,
					coordination_db: db,
					notify_coordination_messages: async () => undefined,
					require_session_id: () =>
						'019f0f71-967e-7aed-853c-94ac29fbe7b6',
				},
			);

			expect(result.content[0]?.text).toContain(
				'019f0f71-967e-7aed-853c-94ac29fbe7b6',
			);
		} finally {
			db.close();
		}
	});

	it('creates visible resumable teammate sessions', async () => {
		const db = await tmp_db();
		try {
			const session_dir = mkdtempSync(
				join(tmpdir(), 'pi-team-sessions-'),
			);
			dirs.push(session_dir);
			const lead = SessionManager.create('/repo', session_dir);
			db.register_session({
				session_id: lead.getSessionId(),
				session_file: lead.getSessionFile(),
				cwd: '/repo',
				role: 'lead',
			});

			const wake_visible_teammate_session = vi.fn(
				async () => undefined,
			);
			const result = await execute_coordination_action(
				{
					action: 'member_spawn',
					name: 'teammate-a',
					message: 'Inspect the failing test.',
				},
				{
					ctx: { cwd: '/repo', sessionManager: lead } as any,
					coordination_db: db,
					notify_coordination_messages: async () => undefined,
					require_session_id: () => lead.getSessionId(),
					wake_visible_teammate_session,
				},
			);

			const teammate = result.details.teammate as {
				session_id: string;
				session_file: string;
			};
			expect(db.get_session(teammate.session_id)).toMatchObject({
				agent_name: 'teammate-a',
				role: 'teammate',
				status: 'offline',
				availability: 'standby',
				parent_session_id: lead.getSessionId(),
			});
			expect(existsSync(teammate.session_file)).toBe(true);
			expect(readFileSync(teammate.session_file, 'utf8')).toContain(
				'Inspect the failing test.',
			);
			expect(wake_visible_teammate_session).toHaveBeenCalledWith({
				session_file: teammate.session_file,
				cwd: '/repo',
				message: 'Inspect the failing test.',
				from_session_id: lead.getSessionId(),
				member: 'teammate-a',
				role: 'teammate',
				report_to_session_ids: [lead.getSessionId()],
				timeout_ms: undefined,
			});
			expect(result.content[0]?.text).toContain(
				'started background task execution',
			);
		} finally {
			db.close();
		}
	});

	it('awaits persistent member readiness and returns structured acceptance', async () => {
		const db = await tmp_db();
		try {
			process.env[TEAM_RUNTIME_ENV] = 'persistent';
			const session_dir = mkdtempSync(
				join(tmpdir(), 'pi-team-sessions-'),
			);
			dirs.push(session_dir);
			const lead = SessionManager.create('/repo', session_dir);
			db.register_session({
				session_id: lead.getSessionId(),
				session_file: lead.getSessionFile(),
				cwd: '/repo',
				role: 'lead',
			});
			const wake_visible_teammate_session = vi.fn(async () => ({
				mode: 'persistent' as const,
				accepted: true,
				method: 'start' as const,
				runtime: { state: 'running' as const },
			}));

			const result = await execute_coordination_action(
				{
					action: 'member_spawn',
					name: 'persistent-worker',
					message: 'Start the task.',
					role: 'peer',
				},
				{
					ctx: { cwd: '/repo', sessionManager: lead } as any,
					coordination_db: db,
					notify_coordination_messages: async () => undefined,
					require_session_id: () => lead.getSessionId(),
					wake_visible_teammate_session:
						wake_visible_teammate_session as any,
				},
			);

			expect(wake_visible_teammate_session).toHaveBeenCalledWith(
				expect.objectContaining({
					message: 'Start the task.',
					role: 'peer',
				}),
			);
			expect(result.details.runtime).toEqual({
				mode: 'persistent',
				accepted: true,
				method: 'start',
				state: 'running',
			});
			expect(result.content[0]?.text).toContain(
				'persistent runtime accepted initial prompt',
			);

			wake_visible_teammate_session.mockRejectedValueOnce(
				new Error('host failed readiness'),
			);
			const failure = await execute_coordination_action(
				{
					action: 'member_spawn',
					name: 'failed-worker',
					message: 'Start the task.',
				},
				{
					ctx: { cwd: '/repo', sessionManager: lead } as any,
					coordination_db: db,
					notify_coordination_messages: async () => undefined,
					require_session_id: () => lead.getSessionId(),
					wake_visible_teammate_session:
						wake_visible_teammate_session as any,
				},
			);
			expect(failure.details.runtime).toEqual({
				mode: 'persistent',
				accepted: false,
				error: 'host failed readiness',
			});
			expect(failure.content[0]?.text).toContain(
				'persistent runtime failed: host failed readiness',
			);
		} finally {
			db.close();
		}
	});

	it.each([
		['running', false, 'follow_up'],
		['idle', false, 'prompt'],
		['running', true, 'steer'],
	] as const)(
		'delivers natively to a %s runtime with urgent=%s via %s',
		async (state, urgent, method) => {
			const db = await tmp_db();
			try {
				db.register_session({ session_id: 'lead', cwd: '/repo' });
				db.register_session({
					session_id: 'worker',
					cwd: '/repo',
					status: 'online',
				});
				const runtime = db.create_session_runtime({
					session_id: 'worker',
					runtime_id: 'runtime',
					endpoint: '/tmp/runtime.sock',
					state,
					lease_expires_at: new Date(Date.now() + 60_000).toISOString(),
				})!;
				const deliver_runtime_message = vi.fn(async () => runtime);

				const result = await execute_coordination_action(
					{
						action: 'session_send',
						to: 'worker',
						message: 'Native delivery.',
						urgent,
					},
					{
						ctx: { cwd: '/repo' } as any,
						coordination_db: db,
						notify_coordination_messages: async () => undefined,
						require_session_id: () => 'lead',
						deliver_runtime_message,
					},
				);

				expect(deliver_runtime_message).toHaveBeenCalledWith(
					runtime,
					'Native delivery.',
					method,
					undefined,
				);
				const receipt = db.list_inbox('worker', {
					include_read: true,
				})[0];
				expect(receipt?.delivered_at).toEqual(expect.any(String));
				expect(receipt?.read_at).toBeUndefined();
				expect(receipt?.acknowledged_at).toBeUndefined();
				expect(result.details.runtime_deliveries).toEqual([
					expect.objectContaining({ method, accepted: true }),
				]);
			} finally {
				db.close();
			}
		},
	);

	it('restarts a terminal persistent runtime instead of rejecting its row', async () => {
		const db = await tmp_db();
		try {
			db.register_session({ session_id: 'lead', cwd: '/repo' });
			db.register_session({ session_id: 'worker', cwd: '/repo' });
			db.create_session_runtime({
				session_id: 'worker',
				runtime_id: 'failed-runtime',
				endpoint: '/tmp/runtime.sock',
				state: 'failed',
				lease_expires_at: new Date(0).toISOString(),
			});
			const wake_visible_teammate_session = vi.fn(async () => ({
				mode: 'persistent' as const,
				accepted: true,
				method: 'start' as const,
				runtime: { state: 'ready' as const },
			}));

			const result = await execute_coordination_action(
				{
					action: 'session_send',
					to: 'worker',
					message: 'Recover and continue.',
				},
				{
					ctx: { cwd: '/repo' } as any,
					coordination_db: db,
					notify_coordination_messages: async () => undefined,
					require_session_id: () => 'lead',
					wake_visible_teammate_session:
						wake_visible_teammate_session as any,
				},
			);

			expect(wake_visible_teammate_session).toHaveBeenCalledWith(
				expect.objectContaining({ message: 'Recover and continue.' }),
			);
			expect(result.details.runtime_deliveries).toEqual([
				expect.objectContaining({
					method: 'start',
					accepted: true,
				}),
			]);
			const receipt = db.list_inbox('worker', {
				include_read: true,
			})[0];
			expect(receipt?.delivered_at).toEqual(expect.any(String));
			expect(receipt?.read_at).toBeUndefined();
		} finally {
			db.close();
		}
	});

	it('leaves a runtime receipt undelivered when native acceptance fails', async () => {
		const db = await tmp_db();
		try {
			db.register_session({ session_id: 'lead', cwd: '/repo' });
			db.register_session({ session_id: 'worker', cwd: '/repo' });
			db.create_session_runtime({
				session_id: 'worker',
				runtime_id: 'runtime',
				endpoint: '/tmp/runtime.sock',
				state: 'idle',
				lease_expires_at: new Date(Date.now() + 60_000).toISOString(),
			});

			await expect(
				execute_coordination_action(
					{
						action: 'session_send',
						to: 'worker',
						message: 'Retry me.',
					},
					{
						ctx: { cwd: '/repo' } as any,
						coordination_db: db,
						notify_coordination_messages: async () => undefined,
						require_session_id: () => 'lead',
						deliver_runtime_message: async () => {
							throw new Error('runtime rejected');
						},
					},
				),
			).rejects.toThrow('runtime rejected');
			expect(
				db.list_inbox('worker', {
					include_read: true,
				})[0]?.delivered_at,
			).toBeUndefined();
		} finally {
			db.close();
		}
	});

	it('runs direct teammate commands and reports to requested recipients', async () => {
		const db = await tmp_db();
		try {
			const session_dir = mkdtempSync(
				join(tmpdir(), 'pi-team-sessions-'),
			);
			dirs.push(session_dir);
			const cwd = mkdtempSync(join(tmpdir(), 'pi-team-cwd-'));
			dirs.push(cwd);
			const lead = SessionManager.create(cwd, session_dir);
			db.register_session({
				session_id: lead.getSessionId(),
				session_file: lead.getSessionFile(),
				cwd,
				role: 'lead',
			});
			db.register_session({ session_id: 'orchestrator', cwd });

			const result = await execute_coordination_action(
				{
					action: 'member_spawn',
					name: 'fast-worker',
					command: 'printf direct-ok',
					reply_to: 'orchestrator',
				},
				{
					ctx: { cwd, sessionManager: lead } as any,
					coordination_db: db,
					notify_coordination_messages: async () => undefined,
					require_session_id: () => lead.getSessionId(),
				},
			);

			const teammate = result.details.teammate as {
				session_id: string;
			};
			await vi.waitFor(() => {
				expect(db.list_inbox(lead.getSessionId())).toHaveLength(1);
				expect(db.list_inbox('orchestrator')).toHaveLength(1);
			});
			expect(db.list_inbox(lead.getSessionId())[0]).toMatchObject({
				from_session_id: teammate.session_id,
			});
			expect(db.list_inbox('orchestrator')[0]?.body).toContain(
				'direct-ok',
			);
			expect(result.content[0]?.text).toContain(
				'started direct command execution',
			);
		} finally {
			db.close();
		}
	});

	it('does not create unflushed live target session files on send', async () => {
		const db = await tmp_db();
		try {
			const session_dir = mkdtempSync(
				join(tmpdir(), 'pi-team-sessions-'),
			);
			dirs.push(session_dir);
			const lead = SessionManager.create('/repo', session_dir);
			const worker = SessionManager.create('/repo', session_dir);
			worker.appendMessage({
				role: 'user',
				content: 'starting',
				timestamp: Date.now(),
			});
			db.register_session({
				session_id: lead.getSessionId(),
				session_file: lead.getSessionFile(),
				cwd: '/repo',
			});
			db.register_session({
				session_id: worker.getSessionId(),
				session_file: worker.getSessionFile(),
				cwd: '/repo',
				agent_name: 'worker',
			});

			await execute_coordination_action(
				{
					action: 'session_send',
					to: 'worker',
					message: 'Please produce the report.',
				},
				{
					ctx: { cwd: '/repo', sessionManager: lead } as any,
					coordination_db: db,
					notify_coordination_messages: async () => undefined,
					require_session_id: () => lead.getSessionId(),
				},
			);

			expect(existsSync(worker.getSessionFile()!)).toBe(false);
			expect(() =>
				worker.appendMessage({
					role: 'assistant',
					content: [{ type: 'text', text: 'ok' }],
				} as any),
			).not.toThrow();
		} finally {
			db.close();
		}
	});

	it('writes session sends into existing target session history', async () => {
		const db = await tmp_db();
		try {
			const session_dir = mkdtempSync(
				join(tmpdir(), 'pi-team-sessions-'),
			);
			dirs.push(session_dir);
			const lead = SessionManager.create('/repo', session_dir);
			const worker = SessionManager.create('/repo', session_dir);
			worker.appendMessage({
				role: 'assistant',
				content: [{ type: 'text', text: 'ready' }],
			} as any);
			db.register_session({
				session_id: lead.getSessionId(),
				session_file: lead.getSessionFile(),
				cwd: '/repo',
			});
			db.register_session({
				session_id: worker.getSessionId(),
				session_file: worker.getSessionFile(),
				cwd: '/repo',
				agent_name: 'worker',
			});

			await execute_coordination_action(
				{
					action: 'session_send',
					to: 'worker',
					message: 'Please produce the report.',
				},
				{
					ctx: { cwd: '/repo', sessionManager: lead } as any,
					coordination_db: db,
					notify_coordination_messages: async () => undefined,
					require_session_id: () => lead.getSessionId(),
				},
			);

			expect(
				readFileSync(worker.getSessionFile()!, 'utf8'),
			).toContain('Please produce the report.');
		} finally {
			db.close();
		}
	});

	it('rejects unregistered and foreign send-side identities', async () => {
		const db = await tmp_db();
		try {
			db.register_session({ session_id: 'lead', cwd: '/repo' });
			db.register_session({ session_id: 'victim', cwd: '/repo' });
			db.register_session({ session_id: 'worker', cwd: '/repo' });
			const context = {
				ctx: { cwd: '/repo' } as any,
				coordination_db: db,
				notify_coordination_messages: async () => undefined,
				require_session_id: () => 'lead',
			};

			await expect(
				execute_coordination_action(
					{
						action: 'session_send',
						from: 'not-a-session',
						to: 'worker',
						message: 'Please report.',
					},
					context,
				),
			).rejects.toThrow(/bound to the current session/);
			await expect(
				execute_coordination_action(
					{
						action: 'session_send',
						from: 'victim',
						to: 'worker',
						message: 'Please report.',
					},
					context,
				),
			).rejects.toThrow(/sender spoofing/);
			expect(db.list_inbox('worker')).toEqual([]);
		} finally {
			db.close();
		}
	});

	it('resolves sender aliases for session sends', async () => {
		const db = await tmp_db();
		try {
			db.register_session({
				session_id: 'lead-session',
				cwd: '/repo',
				agent_name: 'lead',
			});
			db.register_session({ session_id: 'worker', cwd: '/repo' });

			await execute_coordination_action(
				{
					action: 'session_send',
					from: 'lead',
					to: 'worker',
					message: 'Please report.',
				},
				{
					ctx: { cwd: '/repo' } as any,
					coordination_db: db,
					notify_coordination_messages: async () => undefined,
					require_session_id: () => 'lead-session',
				},
			);

			expect(db.list_inbox('worker')[0]).toMatchObject({
				from_session_id: 'lead-session',
			});
		} finally {
			db.close();
		}
	});

	it('waits on the current inbox even when a foreign to is supplied', async () => {
		const db = await tmp_db();
		try {
			db.register_session({ session_id: 'parent', cwd: '/repo' });
			db.register_session({ session_id: 'lead', cwd: '/repo' });
			db.register_session({ session_id: 'worker', cwd: '/repo' });
			db.send_to_session_target({
				from_session_id: 'worker',
				target: 'lead',
				body: 'worker result',
			});
			db.send_to_session_target({
				from_session_id: 'lead',
				target: 'parent',
				body: 'lead result',
			});

			const result = await execute_coordination_action(
				{ action: 'session_wait', to: 'lead', timeout_ms: 0 },
				{
					ctx: { cwd: '/repo' } as any,
					coordination_db: db,
					notify_coordination_messages: async () => undefined,
					require_session_id: () => 'parent',
				},
			);

			expect(result.content[0]?.text).toContain('lead result');
			expect(result.content[0]?.text).not.toContain('worker result');
		} finally {
			db.close();
		}
	});

	it('resolves session_wait from aliases before filtering senders', async () => {
		const db = await tmp_db();
		try {
			db.register_session({ session_id: 'parent', cwd: '/repo' });
			db.register_session({
				session_id: 'lead-session',
				cwd: '/repo',
				agent_name: 'tree-lead',
			});
			db.send_to_session_target({
				from_session_id: 'lead-session',
				target: 'parent',
				body: 'lead result',
			});

			const result = await execute_coordination_action(
				{ action: 'session_wait', from: 'tree-lead', timeout_ms: 0 },
				{
					ctx: { cwd: '/repo' } as any,
					coordination_db: db,
					notify_coordination_messages: async () => undefined,
					require_session_id: () => 'parent',
				},
			);

			expect(result.content[0]?.text).toContain('lead result');
		} finally {
			db.close();
		}
	});

	it('does not let message_wait select another inbox', async () => {
		const db = await tmp_db();
		try {
			db.register_session({ session_id: 'parent', cwd: '/repo' });
			db.register_session({ session_id: 'lead', cwd: '/repo' });
			db.register_session({ session_id: 'worker', cwd: '/repo' });
			db.send_to_session_target({
				from_session_id: 'worker',
				target: 'lead',
				body: 'worker result',
			});

			const result = await execute_coordination_action(
				{ action: 'message_wait', to: 'lead', timeout_ms: 0 },
				{
					ctx: { cwd: '/repo' } as any,
					coordination_db: db,
					notify_coordination_messages: async () => undefined,
					require_session_id: () => 'parent',
				},
			);

			expect(result.content[0]?.text).not.toContain('worker result');
			expect(result.content[0]?.text).toContain(
				'No matching inbox messages.',
			);
		} finally {
			db.close();
		}
	});

	it('marks waited messages read so auto-injection does not repeat them', async () => {
		const db = await tmp_db();
		try {
			db.register_session({ session_id: 'lead', cwd: '/repo' });
			db.register_session({ session_id: 'worker', cwd: '/repo' });
			db.send_to_session_target({
				from_session_id: 'worker',
				target: 'lead',
				body: 'pong',
			});

			const result = await execute_coordination_action(
				{ action: 'session_wait', timeout_ms: 0 },
				{
					ctx: { cwd: '/repo' } as any,
					coordination_db: db,
					notify_coordination_messages: async () => undefined,
					require_session_id: () => 'lead',
				},
			);

			expect(result.content[0]?.text).toContain('pong');
			expect(
				db.list_inbox('lead', {
					undelivered_only: true,
					include_read: true,
				}),
			).toEqual([]);
		} finally {
			db.close();
		}
	});

	it('limits read and ack output to requested message ids', async () => {
		const db = await tmp_db();
		try {
			db.register_session({ session_id: 'lead', cwd: '/repo' });
			db.register_session({ session_id: 'worker', cwd: '/repo' });
			const first = db.send_to_session_target({
				from_session_id: 'worker',
				target: 'lead',
				body: 'first',
			});
			db.send_to_session_target({
				from_session_id: 'worker',
				target: 'lead',
				body: 'second',
			});

			const result = await execute_coordination_action(
				{
					action: 'session_ack',
					message_ids: [first.message_id],
				},
				{
					ctx: { cwd: '/repo' } as any,
					coordination_db: db,
					notify_coordination_messages: async () => undefined,
					require_session_id: () => 'lead',
				},
			);

			expect(result.content[0]?.text).toContain(
				`Acknowledged 1 coordination message: ${first.message_id}`,
			);
			expect(result.content[0]?.text).not.toContain('first');
			expect(result.content[0]?.text).not.toContain('second');
		} finally {
			db.close();
		}
	});

	it('does not echo message bodies in read confirmations', async () => {
		const db = await tmp_db();
		try {
			db.register_session({ session_id: 'lead', cwd: '/repo' });
			db.register_session({ session_id: 'worker', cwd: '/repo' });
			const message = db.send_to_session_target({
				from_session_id: 'worker',
				target: 'lead',
				body: `please inspect ${'private context '.repeat(40)}final detail`,
			});

			const result = await execute_coordination_action(
				{ action: 'session_read' },
				{
					ctx: { cwd: '/repo' } as any,
					coordination_db: db,
					notify_coordination_messages: async () => undefined,
					require_session_id: () => 'lead',
				},
			);

			expect(result.content[0]?.text).toBe(
				`Marked 1 coordination message read: ${message.message_id}`,
			);
			expect(result.content[0]?.text).not.toContain(
				'private context',
			);
			expect(result.content[0]?.text).not.toContain('[truncated]');
		} finally {
			db.close();
		}
	});

	it('does not show acknowledged messages in default or include_read inbox output', async () => {
		const db = await tmp_db();
		try {
			db.register_session({ session_id: 'lead', cwd: '/repo' });
			db.register_session({ session_id: 'worker', cwd: '/repo' });
			const message = db.send_to_session_target({
				from_session_id: 'worker',
				target: 'lead',
				body: 'Acknowledged — teammate session is ready.',
			});
			db.mark_messages_delivered('lead', [message.message_id]);
			db.mark_messages_read('lead', [message.message_id]);
			db.mark_messages_acknowledged('lead', [message.message_id]);
			const context = {
				ctx: { cwd: '/repo' } as any,
				coordination_db: db,
				notify_coordination_messages: async () => undefined,
				require_session_id: () => 'lead',
			};

			const compact = await execute_coordination_action(
				{ action: 'session_inbox', include_read: true },
				context,
			);
			const full = await execute_coordination_action(
				{ action: 'session_inbox', include_read: true, mode: 'full' },
				context,
			);

			expect(compact.content[0]?.text).not.toContain(
				'Acknowledged — teammate session is ready.',
			);
			expect(full.content[0]?.text).toContain(
				'Acknowledged — teammate session is ready.',
			);
		} finally {
			db.close();
		}
	});

	it('starts background delivery for offline visible teammates', async () => {
		const db = await tmp_db();
		try {
			db.register_session({ session_id: 'lead', cwd: '/repo' });
			db.register_session({
				session_id: 'worker',
				cwd: '/repo',
				agent_name: 'worker',
				status: 'offline',
				metadata: { created_by: 'team_mode_visible_session' },
			});

			const result = await execute_coordination_action(
				{ action: 'session_send', to: 'worker', message: 'Ping.' },
				{
					ctx: { cwd: '/repo' } as any,
					coordination_db: db,
					notify_coordination_messages: async () => undefined,
					require_session_id: () => 'lead',
				},
			);

			const inbox = db.list_inbox('worker', {
				undelivered_only: true,
				include_read: true,
			});
			expect(result.content[0]?.text).toContain(
				'Started background delivery for 1 offline visible teammate',
			);
			expect(inbox).toEqual([]);
			expect(
				db.list_inbox('worker', { include_read: true })[0]?.read_at,
			).toBeUndefined();
		} finally {
			db.close();
		}
	});

	it('uses compact session inbox output unless mode is full', async () => {
		const db = await tmp_db();
		try {
			db.register_session({ session_id: 'lead', cwd: '/repo' });
			db.register_session({ session_id: 'worker', cwd: '/repo' });
			db.send_to_session_target({
				from_session_id: 'lead',
				target: 'worker',
				body: `please inspect ${'private context '.repeat(40)}final detail`,
			});

			const context = {
				ctx: { cwd: '/repo' } as any,
				coordination_db: db,
				notify_coordination_messages: async () => undefined,
				require_session_id: () => 'worker',
			};
			const compact = await execute_coordination_action(
				{ action: 'session_inbox' },
				context,
			);
			const full = await execute_coordination_action(
				{ action: 'session_inbox', mode: 'full' },
				context,
			);

			expect(compact.content[0]?.text).toContain('[truncated]');
			expect(compact.content[0]?.text).toContain('body_length:');
			expect(compact.content[0]?.text).toContain('chunk_count:');
			expect(compact.content[0]?.text).not.toContain('final detail');
			expect(JSON.stringify(compact.details)).not.toContain(
				'private context',
			);
			expect(full.content[0]?.text).toContain('final detail');
		} finally {
			db.close();
		}
	});

	it('retrieves focused session message chunks with bounds', async () => {
		const db = await tmp_db();
		try {
			db.register_session({ session_id: 'lead', cwd: '/repo' });
			db.register_session({ session_id: 'worker', cwd: '/repo' });
			const message = db.send_to_session_target({
				from_session_id: 'lead',
				target: 'worker',
				body: `${'first '.repeat(260)}${'second '.repeat(260)}${'third '.repeat(260)}`,
			});
			const context = {
				ctx: { cwd: '/repo' } as any,
				coordination_db: db,
				notify_coordination_messages: async () => undefined,
				require_session_id: () => 'worker',
			};

			const chunk = await execute_coordination_action(
				{
					action: 'session_inbox',
					message_id: message.message_id,
					chunk_index: 1,
				},
				context,
			);
			const range = await execute_coordination_action(
				{
					action: 'session_inbox',
					message_id: message.message_id,
					chunk_index: 1,
					before: 1,
					after: 1,
				},
				context,
			);

			expect(chunk.content[0]?.text).toContain('chunk 2/');
			expect(chunk.content[0]?.text).not.toContain('chunk 1/');
			expect(range.content[0]?.text).toContain('chunk 1/');
			expect(range.content[0]?.text).toContain('chunk 2/');
			expect(range.content[0]?.text).toContain('chunk 3/');
		} finally {
			db.close();
		}
	});

	it('lists artifact chunk metadata and retrieves chunks or full body', async () => {
		const db = await tmp_db();
		try {
			db.register_session({ session_id: 'lead', cwd: '/repo' });
			const artifact = db.create_artifact({
				kind: 'handoff',
				owner_session_id: 'lead',
				cwd: '/repo',
				title: 'handoff',
				summary: 'summary',
				body: `${'a'.repeat(1200)}${'b'.repeat(1200)}final detail`,
			});
			const context = {
				ctx: { cwd: '/repo' } as any,
				coordination_db: db,
				notify_coordination_messages: async () => undefined,
				require_session_id: () => 'lead',
			};

			const list = await execute_coordination_action(
				{ action: 'artifact_list' },
				context,
			);
			const chunk = await execute_coordination_action(
				{
					action: 'artifact_get',
					artifact_id: artifact.artifact_id,
					chunk_index: 1,
				},
				context,
			);
			const full = await execute_coordination_action(
				{
					action: 'artifact_get',
					artifact_id: artifact.artifact_id,
					mode: 'full',
				},
				context,
			);

			expect(list.content[0]?.text).toContain('chunk_count:');
			expect(chunk.content[0]?.text).toContain('chunk 2/');
			expect(chunk.content[0]?.text).toContain('bbb');
			expect(chunk.content[0]?.text).not.toContain('final detail');
			expect(full.content[0]?.text).toContain('final detail');
		} finally {
			db.close();
		}
	});
});
