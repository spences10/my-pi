import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
	append_visible_team_message,
	legacy_wake_args,
	run_direct_teammate_command,
	should_use_persistent_team_runtime,
	TEAM_RUNTIME_ENV,
} from './visible-sessions.js';

const dirs: string[] = [];
const original_runtime = process.env[TEAM_RUNTIME_ENV];
const original_canary = process.env.MY_PI_PRIVATE_CANARY;

afterEach(() => {
	if (original_runtime === undefined) delete process.env[TEAM_RUNTIME_ENV];
	else process.env[TEAM_RUNTIME_ENV] = original_runtime;
	if (original_canary === undefined) delete process.env.MY_PI_PRIVATE_CANARY;
	else process.env.MY_PI_PRIVATE_CANARY = original_canary;
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('experimental persistent visible sessions', () => {
	it('keeps the legacy runtime as the default', () => {
		delete process.env[TEAM_RUNTIME_ENV];
		expect(should_use_persistent_team_runtime()).toBe(false);
		process.env[TEAM_RUNTIME_ENV] = 'persistent';
		expect(should_use_persistent_team_runtime()).toBe(true);
	});

	it('keeps initial legacy task text out of process arguments', () => {
		const args = legacy_wake_args(
			'/usr/bin/pi',
			'/tmp/session.jsonl',
			'coordination prompt',
		);
		expect(args).not.toContain('private initial task');
		expect(args.at(-1)).toBe('--print');
	});

	it('sanitizes and bounds direct command diagnostics with a safe env', async () => {
		process.env.MY_PI_PRIVATE_CANARY = 'ambient-secret';
		const result = await run_direct_teammate_command({
			cwd: tmpdir(),
			command:
				'printf "$MY_PI_PRIVATE_CANARY$MY_PI_TEAM_ROLE:$MY_PI_TEAM_MEMBER"; printf "OPENAI_API_KEY=visible-secret" >&2; head -c 70000 /dev/zero | tr "\\0" x',
			member: 'direct-worker',
			role: 'peer',
		});

		expect(result.stdout).not.toContain('ambient-secret');
		expect(result.stdout).toMatch(/^peer:direct-worker/);
		expect(result.stderr).not.toContain('visible-secret');
		expect(result.stderr).toContain('[REDACTED]');
		expect(result.diagnostics.stdout).toMatchObject({
			stored_bytes: 64 * 1024,
			truncated: true,
		});
	});

	it('never rewrites a persistent owner session JSONL externally', () => {
		const dir = mkdtempSync(join(tmpdir(), 'pi-visible-'));
		dirs.push(dir);
		const session_file = join(dir, 'session.jsonl');
		const original = '{"type":"session","version":3,"id":"session","timestamp":"2026-01-01T00:00:00.000Z","cwd":"/tmp"}\n';
		writeFileSync(session_file, original);
		process.env[TEAM_RUNTIME_ENV] = 'persistent';
		expect(
			append_visible_team_message(session_file, dir, '/tmp', 'message', {}),
		).toBeUndefined();
		expect(readFileSync(session_file, 'utf8')).toBe(original);
	});
});
