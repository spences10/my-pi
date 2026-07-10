import { describe, expect, it } from 'vitest';
import { detect_standby_registration } from './standby.js';

describe('detect_standby_registration', () => {
	it('detects lazy standby subordinate prompts', () => {
		expect(
			detect_standby_registration('standby for orchestrator'),
		).toEqual({ availability: 'standby', intent: 'subordinate' });
		expect(
			detect_standby_registration("you're the subordinate, standby"),
		).toEqual({ availability: 'standby', intent: 'subordinate' });
	});

	it('detects handoff targets and explicit coordination availability', () => {
		expect(
			detect_standby_registration('standby for handoff'),
		).toEqual({ availability: 'standby', intent: 'handoff-target' });
		expect(
			detect_standby_registration('available for coordination'),
		).toEqual({ availability: 'standby', intent: 'standby' });
	});

	it('ignores normal prompts and teammate planning language', () => {
		expect(
			detect_standby_registration('please inspect this diff'),
		).toBeUndefined();
		expect(
			detect_standby_registration(
				'create a teammate to inspect this and prepare a handoff',
			),
		).toBeUndefined();
	});
});
