import {
	start_observability_server,
	type RunningObservabilityServer,
} from '@spences10/pi-observability/server';
import { TeamDatabase } from '@spences10/pi-team-mode/coordination';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vite-plus/test';
import { WorkerManager, type WorkerInfo } from './manager.js';
import { WorkerProcess } from './rpc.js';

const cli = join(
	dirname(
		fileURLToPath(
			import.meta.resolve('@earendil-works/pi-coding-agent'),
		),
	),
	'cli.js',
);

const provider = fileURLToPath(
	new URL('./fixtures/provider.ts', import.meta.url),
);

const team_extension = fileURLToPath(
	import.meta.resolve('@spences10/pi-team-mode'),
);

const observability_extension = fileURLToPath(
	import.meta.resolve('@spences10/pi-observability'),
);

const workers_extension = fileURLToPath(
	new URL('./index.ts', import.meta.url),
);

const cleanup: (() => Promise<void> | void)[] = [];

afterEach(async () => {
	for (const close of cleanup.splice(0).reverse()) await close();
});

async function setup() {
	const directory = mkdtempSync(
		join(tmpdir(), 'pi-workers-integration-'),
	);

	cleanup.push(() =>
		rmSync(directory, { recursive: true, force: true }),
	);

	const server = start_observability_server({
		host: '127.0.0.1',
		port: 0,
		token: 'worker-test-only',
		db_path: join(directory, 'observability.db'),
		log: false,
	});

	await new Promise<void>((resolve) => {
		if (server.server.listening) resolve();
		else server.server.once('listening', resolve);
	});
	server.url = `http://127.0.0.1:${(server.server.address() as { port: number }).port}`;
	cleanup.push(() => server.close());
	const port_server = createServer();
	await new Promise<void>((resolve) =>
		port_server.listen(0, '127.0.0.1', resolve),
	);

	const broker_port = (port_server.address() as { port: number })
		.port;

	await new Promise<void>((resolve, reject) =>
		port_server.close((error) => (error ? reject(error) : resolve())),
	);

	const env = {
		...process.env,
		PI_CODING_AGENT_DIR: directory,
		PI_SKIP_VERSION_CHECK: '1',
		PI_OFFLINE: '1',
		MY_PI_COORDINATION_DB: join(directory, 'coordination.db'),
		MY_PI_COORDINATION_BROKER_PORT: String(broker_port),
		MY_PI_OBSERVABILITY_URL: server.url,
		MY_PI_OBSERVABILITY_TOKEN: server.token,
	};

	const args = [
		cli,
		'--no-extensions',
		'--no-skills',
		'--no-themes',
		'--no-prompt-templates',
		'--no-context-files',
		'-e',
		provider,
		'-e',
		team_extension,
		'-e',
		observability_extension,
		'-e',
		workers_extension,
	];

	const completed: WorkerInfo[] = [];

	const manager = new WorkerManager({
		command: process.execPath,
		args,
		env,
		session_dir: join(directory, 'workers'),
		on_complete: (info) => completed.push(info),
		on_dialogs_end: () => {},
		on_ui: (_id, _request, respond) => respond({ confirmed: false }),
	});

	cleanup.push(() => manager.dispose());

	return {
		directory,
		server,
		env,
		args,
		manager,
		completed,
		options: {
			name: 'rpc-worker',
			task: 'hello',
			cwd: directory,
			model: 'worker-test/test',
			thinking: 'off',
		},
	};
}

async function observed_sessions(server: RunningObservabilityServer) {
	const response = await fetch(`${server.url}/sessions`, {
		headers: { authorization: `Bearer ${server.token}` },
	});

	expect(response.ok).toBe(true);

	return (
		(await response.json()) as {
			sessions: { session_id: string; event_count: number }[];
		}
	).sessions;
}

describe('real upstream Pi RPC workers', () => {
	it.each([true, false])(
		'applies persistent completion policy with Team Mode loaded=%s',
		async (with_team) => {
			const { args, env, directory, options } = await setup();

			const parent_args = args.filter(
				(arg, index) =>
					with_team ||
					(arg !== team_extension &&
						!(arg === '-e' && args[index + 1] === team_extension)),
			);

			let settled = 0;

			const parent = new WorkerProcess({
				command: process.execPath,
				args: [
					...parent_args,
					'--mode',
					'rpc',
					'--model',
					options.model,
					'--session-dir',
					join(directory, 'parent'),
				],
				cwd: directory,
				env: { ...env, MY_PI_WORKER_CHILD: '' },
				on_record: (record) => {
					if (record.type === 'agent_settled') settled++;
				},
				on_exit: () => {},
			});

			cleanup.push(() => parent.stop());
			parent.start();
			const state = await parent.request({ type: 'get_state' });
			const parent_id = state.sessionId as string;
			await parent.request({
				type: 'prompt',
				message: '/workers pause',
			});
			await parent.request({
				type: 'prompt',
				message: `spawn-owned:${directory}`,
			});
			const db = await TeamDatabase.open(env.MY_PI_COORDINATION_DB);

			try {
				await expect
					.poll(() => db.list_inbox(parent_id).length, {
						timeout: 15_000,
					})
					.toBe(1);

				const child = db
					.list_sessions({ include_offline: true })
					.find(
						(session) => session.parent_session_id === parent_id,
					)!;

				expect(child).toBeDefined();
				expect(child.metadata.worker_id).toBeTruthy();
				expect(db.list_inbox(parent_id)[0]).toMatchObject({
					delivered_at: undefined,
					read_at: undefined,
					acknowledged_at: undefined,
				});
				expect(() => process.kill(child.pid!, 0)).not.toThrow();
				await expect
					.poll(() => settled, { timeout: 15_000 })
					.toBeGreaterThanOrEqual(1);
				await parent.request({
					type: 'prompt',
					message: '/workers resume',
				});
				expect(db.delivery.controls(parent_id)).toContainEqual({
					scope: 'session',
					target: '',
					paused: 0,
				});
				expect(db.list_auto_inbox(parent_id)).toEqual([]);
				await parent.request({
					type: 'prompt',
					message: `send-owned:${child.session_id}`,
				});
				await expect
					.poll(() => db.list_inbox(parent_id).length, {
						timeout: 15_000,
					})
					.toBe(2);
				await expect
					.poll(
						() =>
							db
								.list_inbox(parent_id)
								.filter((message) => !!message.delivered_at).length,
						{ timeout: 15_000 },
					)
					.toBe(1);
				expect(db.list_inbox(parent_id)).toHaveLength(2);

				const history = JSON.stringify(
					await parent.request({ type: 'get_messages' }),
				);

				expect(history).toContain('team-mode-peer-message');
				expect(history).toContain('fresh task');
			} finally {
				db.close();
			}
		},
		40_000,
	);

	it('runs a provider turn, persists its transcript, and appears in observability', async () => {
		const { manager, completed, options, server } = await setup();
		const worker = await manager.spawn(options);
		await expect
			.poll(() => completed[0]?.result, { timeout: 15_000 })
			.toBe('reply: hello');
		expect(worker.session_id).toBeTruthy();
		expect(worker.session_file).toBeTruthy();
		expect(readFileSync(worker.session_file!, 'utf8')).toContain(
			'reply: hello',
		);
		await expect
			.poll(
				async () =>
					(await observed_sessions(server)).some(
						(session) =>
							session.session_id === worker.session_id &&
							session.event_count > 2,
					),
				{ timeout: 10_000 },
			)
			.toBe(true);
		await manager.send(worker.id, 'approval');
		await expect
			.poll(() => completed.length, { timeout: 10_000 })
			.toBe(2);
		expect(completed[1].result).toContain('denied');
		await manager.stop(worker.id);
		expect(() => process.kill(worker.pid!, 0)).toThrow();
	}, 30_000);

	it('exchanges Team Mode messages with an independently started session', async () => {
		const {
			manager,
			completed,
			options,
			server,
			env,
			args,
			directory,
		} = await setup();

		const peer = new WorkerProcess({
			command: process.execPath,
			args: [
				...args,
				'--mode',
				'rpc',
				'--model',
				options.model,
				'--session-dir',
				join(directory, 'peer'),
				'--name',
				'manual-peer',
			],
			cwd: directory,
			env: { ...env, MY_PI_TEAM_MEMBER: 'manual-peer' },
			on_record: () => {},
			on_exit: () => {},
		});

		cleanup.push(() => peer.stop());
		peer.start();
		const state = await peer.request({ type: 'get_state' });
		const peer_id = state.sessionId;

		if (typeof peer_id !== 'string')
			throw new Error('Peer did not report a session id');

		const worker = await manager.spawn({
			...options,
			task: `send-peer:${peer_id}`,
		});

		await expect
			.poll(() => completed[0]?.result, { timeout: 15_000 })
			.toContain('Sent coordination message');
		// Mere discovery in the same cwd does not enroll a peer.
		expect(
			JSON.stringify(await peer.request({ type: 'get_messages' })),
		).not.toContain('hello from rpc-worker');
		const db = await TeamDatabase.open(env.MY_PI_COORDINATION_DB);

		try {
			const group = db.create_group({
				name: 'explicit-collaboration',
				created_by_session_id: peer_id,
			});

			db.add_group_member({
				group_id: group.group_id,
				session_id: worker.session_id!,
			});
		} finally {
			db.close();
		}

		await manager.send(worker.id, `send-peer:${peer_id}`);
		await expect
			.poll(
				async () =>
					JSON.stringify(
						await peer.request({ type: 'get_messages' }),
					),
				{ timeout: 10_000 },
			)
			.toContain('hello from rpc-worker');
		await peer.request({
			type: 'prompt',
			message: `send-peer:${worker.session_id}`,
			streamingBehavior: 'followUp',
		});
		await expect
			.poll(() => completed.length, { timeout: 15_000 })
			.toBeGreaterThanOrEqual(2);
		await expect
			.poll(() => readFileSync(worker.session_file!, 'utf8'), {
				timeout: 10_000,
			})
			.toContain('hello from manual-peer');
		await expect
			.poll(
				async () =>
					(await observed_sessions(server)).map(
						(session) => session.session_id,
					),
				{ timeout: 10_000 },
			)
			.toEqual(expect.arrayContaining([peer_id, worker.session_id]));
	}, 45_000);
});
