import * as v from 'valibot';
import type { CoordinationSession } from './db/index.js';

const permission_error_schema = v.looseObject({
	code: v.literal('EPERM'),
});

export type ProcessAliveCheck = (pid: number) => boolean;

export function is_process_alive(pid: number): boolean {
	try {
		process.kill(pid, 0);

		return true;
	} catch (error) {
		return v.is(permission_error_schema, error);
	}
}

export function find_stale_sessions(
	sessions: CoordinationSession[],
	is_alive: ProcessAliveCheck = is_process_alive,
): CoordinationSession[] {
	return sessions.filter(
		(session) => session.pid !== undefined && !is_alive(session.pid),
	);
}
