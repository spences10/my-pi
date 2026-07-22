import { describe, expect, it } from 'vitest';
import { run_child } from './process.js';

function process_exists(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

describe('process supervisor', () => {
	it('reports spawn failure as a lost child', async () => {
		const result = await run_child(
			'factory-command-that-does-not-exist',
			[],
			{
				cwd: process.cwd(),
				timeout_ms: 1_000,
			},
		);

		expect(result).toMatchObject({ event: 'error', code: null });
	});

	it('kills an ignoring grandchild before timeout settles', async () => {
		const script = `
			const { spawn } = require('node:child_process');
			const child = spawn(process.execPath, ['-e', "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"], { stdio: 'ignore' });
			console.log(child.pid);
			setInterval(()=>{},1000);
		`;
		const result = await run_child(process.execPath, ['-e', script], {
			cwd: process.cwd(),
			timeout_ms: 100,
		});
		const grandchild_pid = Number(result.stdout.trim());

		expect(result.event).toBe('timeout');
		expect(Number.isInteger(grandchild_pid)).toBe(true);
		expect(process_exists(grandchild_pid)).toBe(false);
	});

	it('cleans up a background descendant after normal leader exit', async () => {
		const script = `
			const { spawn } = require('node:child_process');
			const child = spawn(process.execPath, ['-e', "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"], { stdio: 'ignore', detached: true });
			child.unref();
			console.log(child.pid);
		`;
		const result = await run_child(process.execPath, ['-e', script], {
			cwd: process.cwd(),
			timeout_ms: 10_000,
		});
		const grandchild_pid = Number(result.stdout.trim());

		try {
			expect(result.event).toBe('exit');
			expect(result.code).toBe(0);
			expect(Number.isInteger(grandchild_pid)).toBe(true);
			expect(process_exists(grandchild_pid)).toBe(false);
		} finally {
			if (process_exists(grandchild_pid))
				process.kill(grandchild_pid, 'SIGKILL');
		}
	});

	it('kills an ignoring grandchild before cancellation settles', async () => {
		const controller = new AbortController();
		const script = `
			const { spawn } = require('node:child_process');
			const child = spawn(process.execPath, ['-e', "process.on('SIGTERM',()=>{});setInterval(()=>{},1000)"], { stdio: 'ignore' });
			console.log(child.pid);
			setInterval(()=>{},1000);
		`;
		const run = run_child(process.execPath, ['-e', script], {
			cwd: process.cwd(),
			signal: controller.signal,
			timeout_ms: 10_000,
		});
		await new Promise((resolve) => setTimeout(resolve, 100));
		controller.abort();
		const result = await run;
		const grandchild_pid = Number(result.stdout.trim());
		expect(result.event).toBe('abort');
		expect(Number.isInteger(grandchild_pid)).toBe(true);
		await new Promise((resolve) => setTimeout(resolve, 50));
		expect(process_exists(grandchild_pid)).toBe(false);
	});
});
