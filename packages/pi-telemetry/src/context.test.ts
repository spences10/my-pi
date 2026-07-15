import { describe, expect, it } from 'vitest';
import {
	describe_session_shutdown,
	get_model_identity,
	infer_run_outcome,
	parse_int,
} from './context.js';

describe('packages/pi-telemetry/src/context.ts', () => {
	it('loads without side effects', async () => {
		await expect(import('./context.js')).resolves.toBeDefined();
	});

	it('parses optional integer env values', () => {
		expect(parse_int(undefined)).toBeNull();
		expect(parse_int('3')).toBe(3);
		expect(parse_int('nope')).toBeNull();
	});

	it('normalizes model identity', () => {
		expect(get_model_identity(undefined)).toEqual({
			provider: null,
			id: null,
		});
		expect(get_model_identity({ provider: 'p', id: 'm' })).toEqual({
			provider: 'p',
			id: 'm',
		});
	});

	it('infers aborted runs as unsuccessful', () => {
		expect(
			infer_run_outcome({
				messages: [{ role: 'assistant', stopReason: 'aborted' }],
			}),
		).toEqual({ success: false, error_message: 'agent aborted' });
	});

	it('describes session shutdowns', () => {
		expect(
			describe_session_shutdown({
				reason: 'resume',
				targetSessionFile: '/tmp/next.jsonl',
			}),
		).toBe('session shutdown (resume) → /tmp/next.jsonl');
	});
});
