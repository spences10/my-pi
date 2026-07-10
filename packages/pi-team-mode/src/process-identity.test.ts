import { describe, expect, it, vi } from 'vitest';
import {
	verify_process_identity,
	type ProcessIdentityVerifier,
	type TeamProcessIdentity,
} from './process-identity.js';

const persisted: TeamProcessIdentity = {
	pid: 123,
	platform: 'linux',
	captured_at: '2026-07-10T00:00:00.000Z',
	start_key: 'linux-start-ticks:10',
	command: 'node pi --session /sessions/worker marker-123',
	session_dir: '/sessions/worker',
	marker: 'marker-123',
};

function verifier(
	current: TeamProcessIdentity | undefined,
	alive = true,
): ProcessIdentityVerifier {
	return {
		capture: vi.fn(() => current),
		is_alive: vi.fn(() => alive),
		kill: vi.fn(),
	};
}

describe('verify_process_identity', () => {
	it('accepts the same process start and expected command markers', () => {
		const result = verify_process_identity(
			persisted,
			verifier({ ...persisted, captured_at: 'later' }),
		);

		expect(result).toMatchObject({ ok: true });
	});

	it('fails closed for missing, dead, or uncapturable identities', () => {
		expect(
			verify_process_identity(undefined, verifier(undefined)),
		).toEqual({
			ok: false,
			reason: 'missing persisted process identity',
		});
		expect(
			verify_process_identity(persisted, verifier(undefined, false)),
		).toEqual({ ok: false, reason: 'process is not running' });
		expect(
			verify_process_identity(persisted, verifier(undefined, true)),
		).toEqual({ ok: false, reason: 'process identity unavailable' });
	});

	it('rejects PID reuse when the process start key changes', () => {
		const result = verify_process_identity(
			persisted,
			verifier({ ...persisted, start_key: 'linux-start-ticks:99' }),
		);

		expect(result).toMatchObject({
			ok: false,
			reason: 'process start identity changed',
		});
	});

	it('fails closed when a platform cannot provide process start identity', () => {
		const result = verify_process_identity(
			persisted,
			verifier({ ...persisted, start_key: undefined }),
		);

		expect(result).toMatchObject({
			ok: false,
			reason: 'process start identity unavailable on this platform',
		});
	});

	it.each([
		[
			'other session directory',
			'node pi --session /sessions/other marker-123',
			'process command no longer references teammate session directory',
		],
		[
			'other marker',
			'node pi --session /sessions/worker marker-999',
			'process command no longer contains teammate marker',
		],
	])('rejects a command with %s', (_label, command, reason) => {
		const result = verify_process_identity(
			persisted,
			verifier({ ...persisted, command }),
		);

		expect(result).toMatchObject({ ok: false, reason });
	});
});
