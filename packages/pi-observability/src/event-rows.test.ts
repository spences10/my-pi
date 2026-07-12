import { describe, expect, it } from 'vitest';
import {
	to_row_event,
	to_session_row,
	valid_event,
} from './event-rows.js';

describe('event row adapters', () => {
	it('converts database event rows into observability events', () => {
		expect(
			to_row_event({
				event_id: 'event-1',
				session_id: 'session-1',
				seq: '3',
				ts: '2026-01-01T00:00:00.000Z',
				type: 'tool_result',
				pool: 'demo',
				tags_json: '["alpha"]',
				payload_json: '{"ok":true}',
				provider: 'anthropic',
				model: 'claude',
			}),
		).toMatchObject({
			event_id: 'event-1',
			session_id: 'session-1',
			seq: 3,
			pool: 'demo',
			tags: ['alpha'],
			payload: { ok: true },
			provider: 'anthropic',
			model: 'claude',
		});
	});

	it('converts session rows with optional blank fields omitted', () => {
		expect(
			to_session_row({
				session_id: 'session-1',
				session_file: '',
				cwd: '/repo',
				agent_name: '',
				session_name: 'derek',
				pool: 'default',
				tags_json: '[]',
				provider: '',
				model: '',
				first_ts: 'then',
				last_ts: 'now',
				event_count: '4',
			}),
		).toEqual({
			session_id: 'session-1',
			session_file: undefined,
			cwd: '/repo',
			agent_name: undefined,
			session_name: 'derek',
			pool: 'default',
			tags: [],
			provider: undefined,
			model: undefined,
			first_ts: 'then',
			last_ts: 'now',
			event_count: 4,
		});
	});

	it('accepts only minimally complete event envelopes', () => {
		expect(
			valid_event({
				event_id: 'e',
				session_id: 's',
				seq: 0,
				ts: 't',
				type: 'message',
			}),
		).toBe(true);
		expect(valid_event(null)).toBe(false);
		expect(valid_event({ event_id: 'e', seq: 1 })).toBe(false);
		expect(
			valid_event({
				event_id: 'e',
				session_id: 's',
				seq: 1.5,
				ts: 't',
				type: 'x',
			}),
		).toBe(false);
	});
});
