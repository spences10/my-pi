import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import {
	append_visible_team_message,
	should_use_persistent_team_runtime,
	TEAM_RUNTIME_ENV,
} from './visible-sessions.js';

const dirs: string[] = [];
const original_runtime = process.env[TEAM_RUNTIME_ENV];

afterEach(() => {
	if (original_runtime === undefined) delete process.env[TEAM_RUNTIME_ENV];
	else process.env[TEAM_RUNTIME_ENV] = original_runtime;
	for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('experimental persistent visible sessions', () => {
	it('keeps the legacy runtime as the default', () => {
		delete process.env[TEAM_RUNTIME_ENV];
		expect(should_use_persistent_team_runtime()).toBe(false);
		process.env[TEAM_RUNTIME_ENV] = 'persistent';
		expect(should_use_persistent_team_runtime()).toBe(true);
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
