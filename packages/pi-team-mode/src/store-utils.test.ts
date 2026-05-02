import {
	mkdtempSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
	list_json_files,
	normalize_member_name,
	safe_segment,
	sanitize_event_data,
} from './store-utils.js';

let root: string;

beforeEach(() => {
	root = mkdtempSync(join(tmpdir(), 'my-pi-store-utils-'));
});

afterEach(() => {
	rmSync(root, { recursive: true, force: true });
});

describe('store utils', () => {
	it('normalizes safe path segments and rejects empty segments', () => {
		expect(safe_segment('hello world')).toBe('hello-world');
		expect(() => safe_segment('..')).toThrow(/file-safe/);
	});

	it('requires exact file-safe member names', () => {
		expect(normalize_member_name('alice-1')).toBe('alice-1');
		expect(() => normalize_member_name('alice/dev')).toThrow(
			/letters, numbers/,
		);
	});

	it('redacts and bounds event strings recursively', () => {
		const sanitized = sanitize_event_data({
			text: `token = ghp_${'a'.repeat(40)}\n${'x'.repeat(9000)}`,
		}) as { text: string };

		expect(sanitized.text).toContain('[REDACTED:');
		expect(sanitized.text).not.toContain(`ghp_${'a'.repeat(40)}`);
		expect(sanitized.text).toContain('[truncated');
		expect(sanitized.text.length).toBeLessThan(8100);
	});

	it('quarantines invalid listed json files', () => {
		writeFileSync(
			join(root, 'good.json'),
			JSON.stringify({ id: '1' }),
		);
		writeFileSync(join(root, 'bad.json'), '{');

		expect(list_json_files<{ id: string }>(root)).toEqual([
			{ id: '1' },
		]);
		expect(
			readdirSync(root).some((name) => name.includes('.invalid-')),
		).toBe(true);
	});
});
