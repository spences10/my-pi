import { describe, expect, it } from 'vitest';
import { format_sessions } from './coordination-formatting.js';
import type { CoordinationSession } from './db.js';

const session: CoordinationSession = {
	session_id: '019f0f71-967e-7aed-853c-94ac29fbe7b6',
	cwd: '/repo',
	role: 'peer',
	status: 'online',
	pool: 'default',
	tags: [],
	metadata: {},
	created_at: '2026-06-28T00:00:00.000Z',
	updated_at: '2026-06-28T00:00:00.000Z',
	last_seen_at: '2026-06-28T00:00:00.000Z',
};

describe('coordination formatting', () => {
	it('truncates session ids by default and prints full ids on request', () => {
		expect(format_sessions([session])).toContain('019f0f71-967…');
		expect(format_sessions([session])).not.toContain(
			'019f0f71-967e-7aed-853c-94ac29fbe7b6',
		);

		expect(format_sessions([session], { full_ids: true })).toContain(
			'019f0f71-967e-7aed-853c-94ac29fbe7b6',
		);
	});
});
