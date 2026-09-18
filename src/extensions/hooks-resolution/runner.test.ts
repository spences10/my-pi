import { describe, expect, it } from 'vite-plus/test';
import {
	format_duration,
	hook_block_reason,
	hook_name,
} from './runner.js';

describe('src/extensions/hooks-resolution/runner.ts', () => {
	it('loads without side effects', async () => {
		await expect(import('./runner.js')).resolves.toBeDefined();
	});

	it('formats durations for hook output', () => {
		expect(format_duration(250)).toBe('250ms');
		expect(format_duration(1250)).toBe('1.3s');
	});

	it('extracts display names from hook commands', () => {
		expect(hook_name('bash ./scripts/check.sh')).toBe('check.sh');
		expect(hook_name('node tool.js')).toBe('node');
	});

	it('detects block reasons from hook results', () => {
		expect(
			hook_block_reason({
				code: 0,
				stdout: '{"decision":"block","reason":"stop"}',
				stderr: '',
				elapsed_ms: 1,
				timed_out: false,
			}),
		).toBe('stop');
	});
});
