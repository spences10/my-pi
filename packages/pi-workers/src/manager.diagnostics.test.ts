import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vite-plus/test';
import { WorkerManager, type WorkerInfo } from './manager.js';

const fixture = fileURLToPath(
	new URL('./fixtures/diagnostic-child.ts', import.meta.url),
);

// Deliberately synthetic, matching the isolated child fixture.
const secret = 'sk-synthetic-worker-diagnostic-1234567890';
const managers: WorkerManager[] = [];
const directories: string[] = [];

afterEach(async () => {
	await Promise.all(
		managers.splice(0).map((manager) => manager.dispose()),
	);

	for (const directory of directories.splice(0))
		rmSync(directory, { recursive: true, force: true });
});

function setup(...args: string[]) {
	const directory = mkdtempSync(
		join(tmpdir(), 'pi-worker-diagnostics-'),
	);

	directories.push(directory);
	const completed: WorkerInfo[] = [];

	const manager = new WorkerManager({
		command: process.execPath,
		args: [fixture, ...args],
		env: {},
		session_dir: directory,
		on_complete: (info) => completed.push(info),
		on_dialogs_end: () => {},
		on_ui: () => {},
	});

	managers.push(manager);

	return {
		manager,
		completed,
		options: { name: 'diagnostic', task: 'handled', cwd: directory },
	};
}

function expect_redacted(value: string | undefined) {
	const text = JSON.stringify(value);
	expect(text).not.toContain(secret);
	expect(text).toContain('[REDACTED:');
}

async function expect_safe_error(
	promise: Promise<unknown>,
	label: string,
) {
	const error = await promise.then(
		() => undefined,
		(cause: unknown) => cause,
	);

	expect(error).toBeInstanceOf(Error);

	if (!(error instanceof Error)) throw error;

	expect(String(error)).toContain(label);
	expect_redacted(String(error));
	// Raw causes or original diagnostic fields must not escape either.
	expect(JSON.stringify(error)).not.toContain(secret);
	expect(error.stack).not.toContain(secret);
}

describe('worker diagnostics', () => {
	it('redacts startup stderr in thrown spawn errors, list and completion details', async () => {
		const { manager, completed, options } = setup('--startup-error');
		await expect_safe_error(
			manager.spawn(options),
			'Worker exited (7)',
		);
		expect_redacted(manager.list()[0].error);
		expect_redacted(completed[0].error);
	});

	it.each(['reject', 'crash'])(
		'redacts %s errors thrown from send and retained in list',
		async (message) => {
			const { manager, completed, options } = setup();
			const worker = await manager.spawn(options);
			await expect_safe_error(
				manager.send(worker.id, message),
				message === 'reject' ? 'Prompt refused' : 'Worker exited (7)',
			);
			expect_redacted(manager.list()[0].error);

			if (message === 'crash') expect_redacted(completed[0].error);
		},
	);

	it.each([
		['spawn', 'split-stderr'],
		['send', 'split-stderr'],
		['spawn', 'overflow-stderr'],
		['send', 'overflow-stderr'],
		['spawn', 'split-overflow-stderr'],
		['send', 'split-overflow-stderr'],
	])(
		'protects %s diagnostics for %s without retaining a raw tail',
		async (action, mode) => {
			const password_value = 'synthetic-boundary-value-1234567890';

			const { manager, completed, options } = setup(
				...(action === 'spawn' ? ['--diagnostic-mode=' + mode] : []),
			);

			const operation =
				action === 'spawn'
					? manager.spawn(options)
					: manager.send((await manager.spawn(options)).id, mode);

			const error = await operation.catch((cause: unknown) => cause);
			expect(error).toBeInstanceOf(Error);

			if (!(error instanceof Error)) throw error;

			expect(completed).toHaveLength(1);

			for (const output of [
				String(error),
				error.stack,
				JSON.stringify(error),
				JSON.stringify(manager.list()),
				JSON.stringify(completed),
			])
				expect(output).not.toContain(password_value);

			for (const diagnostic of [
				error.message,
				manager.list()[0].error,
				completed[0].error,
			]) {
				expect(diagnostic).toContain('Worker exited (7)');

				if (mode === 'split-stderr')
					expect(diagnostic).toContain('[REDACTED:');
				else expect(diagnostic).toContain('stderr omitted');
			}
		},
	);

	it('redacts a refused initial prompt thrown from spawn', async () => {
		const { manager, options } = setup();
		await expect_safe_error(
			manager.spawn({ ...options, task: 'reject' }),
			'Prompt refused',
		);
		expect_redacted(manager.list()[0].error);
	});

	it.each(['result', 'error'])(
		'redacts assistant %s text and provider errors before reporting or listing',
		async (task) => {
			const { manager, completed, options } = setup();
			const worker = await manager.spawn({ ...options, task });
			await expect.poll(() => completed.length).toBe(1);
			expect_redacted(completed[0].result);
			expect_redacted(
				(await manager.send(worker.id, 'handled')).result,
			);
			expect_redacted(manager.list()[0].result);

			if (task === 'error') {
				expect_redacted(completed[0].error);
				expect_redacted(manager.list()[0].error);
			} else expect(completed[0].error).toBeUndefined();
		},
	);

	it('redacts filesystem errors raised before creating a worker', async () => {
		const { manager, options } = setup();
		await expect_safe_error(
			manager.spawn({ ...options, cwd: join(options.cwd, secret) }),
			'ENOENT',
		);
	});
});
