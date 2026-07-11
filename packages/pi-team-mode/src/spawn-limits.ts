import type { TeamDatabase } from './db/index.js';

export const TEAM_MAX_DEPTH_ENV = 'MY_PI_TEAM_MAX_DEPTH';
export const TEAM_MAX_CONCURRENT_CHILDREN_ENV =
	'MY_PI_TEAM_MAX_CONCURRENT_CHILDREN';

const DEFAULT_MAX_DEPTH = 3;
const DEFAULT_MAX_CONCURRENT_CHILDREN = 4;
const TERMINAL_RUNTIME_STATES = new Set([
	'completed',
	'failed',
	'stopping',
	'offline',
]);

function positive_integer(
	value: string | undefined,
	fallback: number,
): number {
	if (!value?.trim()) return fallback;
	const parsed = Number(value);
	if (!Number.isSafeInteger(parsed) || parsed < 1)
		throw new Error(
			`Expected a positive integer, received ${JSON.stringify(value)}`,
		);
	return parsed;
}

export function assert_teammate_spawn_allowed(
	db: TeamDatabase,
	parent_session_id: string,
): void {
	const max_depth = positive_integer(
		process.env[TEAM_MAX_DEPTH_ENV],
		DEFAULT_MAX_DEPTH,
	);
	const max_concurrent_children = positive_integer(
		process.env[TEAM_MAX_CONCURRENT_CHILDREN_ENV],
		DEFAULT_MAX_CONCURRENT_CHILDREN,
	);

	let depth = 1;
	let current = db.get_session(parent_session_id);
	const visited = new Set([parent_session_id]);
	while (current?.parent_session_id) {
		if (visited.has(current.parent_session_id))
			throw new Error(
				'Cannot spawn a teammate from a cyclic session hierarchy',
			);
		visited.add(current.parent_session_id);
		depth += 1;
		current = db.get_session(current.parent_session_id);
	}
	if (depth > max_depth)
		throw new Error(
			`Teammate spawn depth ${depth} exceeds MY_PI_TEAM_MAX_DEPTH=${max_depth}`,
		);

	const active_children = db
		.list_sessions({ include_offline: true })
		.filter(
			(session) => session.parent_session_id === parent_session_id,
		)
		.filter((session) => {
			const runtime = db.get_session_runtime(session.session_id);
			if (runtime) return !TERMINAL_RUNTIME_STATES.has(runtime.state);
			return session.status === 'online';
		}).length;
	if (active_children >= max_concurrent_children)
		throw new Error(
			`Session already has ${active_children} active teammates; MY_PI_TEAM_MAX_CONCURRENT_CHILDREN=${max_concurrent_children}`,
		);
}
