import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vite-plus/test';
import { WorkerManager, type WorkerInfo } from './manager.js';
import { WorkerProcess } from './rpc.js';

const fixture = fileURLToPath(
	new URL('./fixtures/rpc-child.ts', import.meta.url),
);
const managers: WorkerManager[] = [];
const processes: WorkerProcess[] = [];
const directories: string[] = [];

afterEach(async () => {
	await Promise.all([
		...managers.splice(0).map((manager) => manager.dispose()),
		...processes.splice(0).map((process) => process.stop()),
	]);
	for (const directory of directories.splice(0))
		rmSync(directory, { recursive: true, force: true });
});

function setup() {
	const directory = mkdtempSync(join(tmpdir(), 'pi-workers-'));
	directories.push(directory);
	const completed: WorkerInfo[] = [];
	const manager = new WorkerManager({
		command: process.execPath,
		args: [fixture],
		env: {},
		session_dir: directory,
		on_complete: (info) => completed.push(info),
		on_dialogs_end: () => {},
		on_ui: (_id, _request, respond) => respond({ confirmed: true }),
	});
	managers.push(manager);
	return {
		manager,
		completed,
		options: { name: 'test', task: 'hello', cwd: directory },
	};
}

describe('owned worker lifecycle', () => {
	it('returns session identity, waits for settled rather than agent_end, and reports once', async () => {
		const { manager, completed, options } = setup();
		const worker = await manager.spawn(options);
		expect(worker.session_id).toMatch(/^session-/);
		expect(worker.status).toBe('running');
		expect(completed).toHaveLength(0);
		await expect.poll(() => completed.length).toBe(1);
		expect(completed[0]).toMatchObject({
			status: 'idle',
			result: 'hello',
		});
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(completed).toHaveLength(1);
	});

	it('does not resurrect a fast completion when prompt acceptance arrives later', async () => {
		const { manager, completed, options } = setup();
		const worker = await manager.spawn({ ...options, task: 'fast' });
		expect(worker.status).toBe('idle');
		expect(completed).toHaveLength(1);
	});

	it('handles intercepted prompts without waiting for a nonexistent run', async () => {
		const { manager, completed, options } = setup();
		const worker = await manager.spawn({
			...options,
			task: 'handled',
		});
		expect(worker.status).toBe('idle');
		expect(completed).toHaveLength(0);
	});

	it('steers and follows up on the same process using its name or session id', async () => {
		const { manager, completed, options } = setup();
		const worker = await manager.spawn({ ...options, task: 'wait' });
		await manager.send(
			options.name,
			'steering\u2028still one record',
		);
		await expect.poll(() => completed.length).toBe(1);
		expect(completed[0].result).toBe(
			'steering\u2028still one record',
		);
		await manager.send(worker.session_id!, 'follow-up', true);
		await expect.poll(() => completed.length).toBe(2);
		expect(completed[1].pid).toBe(worker.pid);
		expect(completed[1].result).toBe('follow-up');
	});

	it('sends by a reused name to its current worker, preserving historical identities', async () => {
		const { manager, options } = setup();
		const old = await manager.spawn({ ...options, task: 'handled' });
		await manager.stop(old.id);
		const current = await manager.spawn({
			...options,
			task: 'handled',
		});

		const sent = await manager.send(options.name, 'fast');
		expect(sent).toMatchObject({
			id: current.id,
			pid: current.pid,
			result: 'fast result',
		});
		await expect(manager.send(old.id, 'fast')).rejects.toThrow(
			'not running',
		);
		await expect(
			manager.send(old.session_id!, 'fast'),
		).rejects.toThrow('not running');
	});

	it('stops the current worker by a reused name without retargeting historical ids or sessions', async () => {
		const { manager, options } = setup();
		const old = await manager.spawn({ ...options, task: 'handled' });
		await manager.stop(old.id);
		const current = await manager.spawn({
			...options,
			task: 'handled',
		});

		expect((await manager.stop(old.id)).id).toBe(old.id);
		expect((await manager.stop(old.session_id!)).id).toBe(old.id);
		expect(
			manager.list().find((info) => info.id === current.id),
		).toMatchObject({ status: 'idle' });
		const stopped = await manager.stop(options.name);
		expect(stopped).toMatchObject({
			id: current.id,
			status: 'stopped',
		});
		expect(() => process.kill(current.pid!, 0)).toThrow();
	});

	it('forwards extension UI responses without bypassing approval', async () => {
		const { manager, completed, options } = setup();
		await manager.spawn({ ...options, task: 'approval' });
		await expect.poll(() => completed[0]?.result).toBe('approved');
	});

	it('reports unexpected process exits and cannot control an independent session', async () => {
		const { manager, completed, options } = setup();
		await expect(
			manager.spawn({ ...options, task: 'crash' }),
		).rejects.toThrow('Worker exited (7)');
		expect(completed[0]).toMatchObject({ status: 'failed' });
		await expect(
			manager.stop('someone-elses-session'),
		).rejects.toThrow('Not an owned worker');
	});

	it('stops all workers on disposal without reporting shutdown as completion', async () => {
		const { manager, completed, options } = setup();
		const worker = await manager.spawn({ ...options, task: 'wait' });
		await manager.dispose();
		expect(manager.list()[0].status).toBe('stopped');
		expect(completed).toHaveLength(0);
		expect(() => process.kill(worker.pid!, 0)).toThrow();
		await expect(manager.spawn(options)).rejects.toThrow('closed');
	});

	it.skipIf(process.platform !== 'linux')(
		'escalates cancellation and terminates stubborn descendants',
		async () => {
			const { manager, completed, options } = setup();
			const worker = await manager.spawn({
				...options,
				task: 'stubborn',
			});
			await expect.poll(() => completed.length).toBe(1);
			const descendant = Number(completed[0].result);
			expect(descendant).toBeGreaterThan(0);
			await manager.stop(worker.id);
			expect(() => process.kill(worker.pid!, 0)).toThrow();
			await expect
				.poll(() => {
					try {
						return readFileSync(
							`/proc/${descendant}/stat`,
							'utf8',
						).split(' ')[2];
					} catch {
						return 'Z';
					}
				})
				.toBe('Z');
		},
	);

	it('does not silently substitute a different model', async () => {
		const { manager, options } = setup();
		await expect(
			manager.spawn({ ...options, model: 'missing/model' }),
		).rejects.toThrow('did not select requested model');
		expect(manager.list()[0].status).toBe('failed');
	});

	it('rejects refused prompts and frees the process', async () => {
		const { manager, options } = setup();
		await expect(
			manager.spawn({ ...options, task: 'reject' }),
		).rejects.toThrow('Prompt refused');
		expect(manager.list()[0].status).toBe('failed');
		expect(() => process.kill(manager.list()[0].pid!, 0)).toThrow();
	});

	it('rejects duplicate names and bounds live workers including idle ones', async () => {
		const { manager, options } = setup();
		await manager.spawn({ ...options, task: 'fast' });
		await expect(manager.spawn(options)).rejects.toThrow(
			'name is already in use',
		);
		for (let index = 1; index < 4; index++)
			await manager.spawn({
				...options,
				name: 'test-' + index,
				task: 'wait',
			});
		await expect(
			manager.spawn({ ...options, name: 'fifth' }),
		).rejects.toThrow('At most 4');
	});

	it('requires an explicit existing absolute working directory', async () => {
		const { manager, options } = setup();
		await expect(
			manager.spawn({ ...options, cwd: '.' }),
		).rejects.toThrow('absolute');
		await expect(
			manager.spawn({ ...options, cwd: fixture }),
		).rejects.toThrow('directory');
	});

	it('cancels startup through the tool signal', async () => {
		const { manager, options } = setup();
		const controller = new AbortController();
		const promise = manager.spawn(options, controller.signal);
		controller.abort();
		await expect(promise).rejects.toThrow();
		expect(manager.list()[0].status).toBe('stopped');
	});

	it('rejects timed-out RPC requests and missing executables', async () => {
		const process_client = new WorkerProcess({
			command: process.execPath,
			args: [fixture, '--hang'],
			cwd: dirname(fixture),
			env: {},
			on_record: () => {},
			on_exit: () => {},
		});
		processes.push(process_client);
		process_client.start();
		await expect(
			process_client.request({ type: 'get_state' }, 20),
		).rejects.toThrow('timed out');
		const missing = new WorkerProcess({
			command: '/does-not-exist/pi',
			args: [],
			cwd: dirname(fixture),
			env: {},
			on_record: () => {},
			on_exit: () => {},
		});
		processes.push(missing);
		missing.start();
		await expect(
			missing.request({ type: 'get_state' }),
		).rejects.toThrow();
	});
});
