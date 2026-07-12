import {
	appendFileSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { session_name_from_file } from './session-name.js';

const dirs: string[] = [];

function session_file(): string {
	const dir = mkdtempSync(join(tmpdir(), 'pi-observability-name-'));
	dirs.push(dir);
	return join(dir, 'session.jsonl');
}

afterEach(() => {
	for (const dir of dirs)
		rmSync(dir, { recursive: true, force: true });
	dirs.length = 0;
});

describe('session_name_from_file', () => {
	it('finds session_info records more than 256 KiB before EOF', () => {
		const path = session_file();
		writeFileSync(
			path,
			`${JSON.stringify({ type: 'session_info', name: 'original' })}\n${`${JSON.stringify({ type: 'message', text: 'x'.repeat(1024) })}\n`.repeat(300)}`,
		);

		expect(session_name_from_file(path)).toBe('original');
	});

	it('incrementally reads an appended rename', () => {
		const path = session_file();
		writeFileSync(
			path,
			`${JSON.stringify({ type: 'session_info', name: 'before' })}\n`,
		);
		expect(session_name_from_file(path)).toBe('before');

		appendFileSync(
			path,
			`${JSON.stringify({ type: 'session_info', name: 'after' })}\n`,
		);
		expect(session_name_from_file(path)).toBe('after');
	});

	it('rescans after truncation', () => {
		const path = session_file();
		writeFileSync(
			path,
			`${JSON.stringify({ type: 'session_info', name: 'a-long-original-name' })}\n`,
		);
		expect(session_name_from_file(path)).toBe('a-long-original-name');

		writeFileSync(
			path,
			`${JSON.stringify({ type: 'session_info', name: 'new' })}\n`,
		);
		expect(session_name_from_file(path)).toBe('new');
	});
});
