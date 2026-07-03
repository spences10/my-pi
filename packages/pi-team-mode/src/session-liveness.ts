import type { CoordinationSession } from './db/index.js';

export type ProcessAliveCheck = (pid: number) => boolean;

export function is_process_alive(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch (error) {
		return (error as NodeJS.ErrnoException).code === 'EPERM';
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
