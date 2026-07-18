import { describe, expect, it } from 'vitest';
import {
	create_health_proof,
	health_proof_matches,
	valid_health_challenge,
} from './health-auth.js';

describe('health authentication', () => {
	it('proves possession of the bearer token without transmitting it', () => {
		const token = 'local-observability-token';
		const challenge = 'challenge_1234567890';
		const proof = create_health_proof(token, challenge);

		expect(proof).not.toContain(token);
		expect(health_proof_matches(token, challenge, proof)).toBe(true);
		expect(
			health_proof_matches('different-token', challenge, proof),
		).toBe(false);
	});

	it.each([
		'challenge_1234567890',
		'550e8400-e29b-41d4-a716-446655440000',
	])('accepts a bounded health challenge: %s', (challenge) => {
		expect(valid_health_challenge(challenge)).toBe(true);
	});

	it.each([null, '', 'short', 'contains spaces and punctuation!'])(
		'rejects an invalid health challenge: %s',
		(challenge) => {
			expect(valid_health_challenge(challenge)).toBe(false);
		},
	);
});
