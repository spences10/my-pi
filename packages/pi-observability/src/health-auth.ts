import { createHmac, timingSafeEqual } from 'node:crypto';

const HEALTH_CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{16,128}$/;

export function valid_health_challenge(
	challenge: string | null,
): challenge is string {
	return Boolean(
		challenge && HEALTH_CHALLENGE_PATTERN.test(challenge),
	);
}

export function create_health_proof(
	token: string,
	challenge: string,
): string {
	return createHmac('sha256', token)
		.update(challenge)
		.digest('base64url');
}

export function health_proof_matches(
	token: string,
	challenge: string,
	proof: unknown,
): boolean {
	if (typeof proof !== 'string') return false;
	const expected = Buffer.from(create_health_proof(token, challenge));
	const provided = Buffer.from(proof);
	return (
		expected.length === provided.length &&
		timingSafeEqual(expected, provided)
	);
}
