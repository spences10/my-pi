import { describe, expect, it } from 'vite-plus/test';
import { sanitize_status_text, strip_ansi } from './text.js';

describe('footer text utils', () => {
	it('strips ansi escape sequences', () => {
		expect(strip_ansi('\u001B[2mMCP 6/6 connected\u001B[22m')).toBe(
			'MCP 6/6 connected',
		);
	});

	it('sanitizes status text after stripping ansi', () => {
		expect(
			sanitize_status_text('\u001B[2mMCP\t6/6\nconnected\u001B[22m'),
		).toBe('MCP 6/6 connected');
	});
});
