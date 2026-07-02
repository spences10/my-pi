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

	it('detects handoff targets', () => {
		expect(
			detect_standby_registration('standby for handoff'),
		).toEqual({ availability: 'standby', intent: 'handoff-target' });
	});

	it('ignores normal prompts', () => {
		expect(
			detect_standby_registration('please inspect this diff'),
		).toBeUndefined();
	});
});
