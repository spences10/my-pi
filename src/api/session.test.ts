import {
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { create_session_manager } from './session.js';

const dirs: string[] = [];

function temp_dir(prefix: string): string {
	const dir = mkdtempSync(join(tmpdir(), prefix));
	dirs.push(dir);
	return dir;
}

afterEach(() => {
	for (const dir of dirs)
		rmSync(dir, { recursive: true, force: true });
	dirs.length = 0;
});

describe('create_session_manager', () => {
	it('opens explicit jsonl sessions relative to cwd', () => {
		const cwd = temp_dir('my-pi-session-cwd-');
		const session_file = join(cwd, 'saved.jsonl');
		writeFileSync(session_file, '');

		const manager = create_session_manager({
			cwd,
			session: 'saved.jsonl',
		});

		expect(manager.getSessionFile()).toBe(session_file);
	});

	it('finds the newest matching session ref in the requested session dir', () => {
		const cwd = temp_dir('my-pi-session-match-');
		const session_dir = join(cwd, 'sessions');
		mkdirSync(session_dir);
		writeFileSync(join(session_dir, '2026-01-alpha.jsonl'), '');
		writeFileSync(join(session_dir, '2026-02-alpha.jsonl'), '');

		const manager = create_session_manager({
			cwd,
			session_dir: 'sessions',
			session_id: 'alpha',
		});

		expect(manager.getSessionFile()).toBe(
			join(session_dir, '2026-02-alpha.jsonl'),
		);
	});

	it('creates a named new session when no session ref matches', () => {
		const cwd = temp_dir('my-pi-session-new-');
		const manager = create_session_manager({
			cwd,
			session_id: 'new-id',
			startup_session_name: 'Fresh Session',
		});

		expect(manager.getSessionId()).toBe('new-id');
		expect(manager.getSessionName()).toBe('Fresh Session');
	});
});
