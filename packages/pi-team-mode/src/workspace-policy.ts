import { existsSync, statSync } from 'node:fs';
import { isAbsolute, resolve } from 'node:path';
import type { TeamDatabase } from './db/index.js';

export function resolve_teammate_workspace(options: {
	db: TeamDatabase;
	lead_cwd: string;
	mode: 'shared' | 'isolated';
	path?: string;
}): string {
	if (options.mode === 'shared') return resolve(options.lead_cwd);
	const requested = options.path?.trim();
	if (!requested || !isAbsolute(requested))
		throw new Error(
			'Isolated teammate workspace_path must be an absolute path',
		);
	const workspace = resolve(requested);
	if (workspace === resolve(options.lead_cwd))
		throw new Error(
			'Isolated teammate workspace must differ from the lead workspace',
		);
	if (!existsSync(workspace) || !statSync(workspace).isDirectory())
		throw new Error(
			`Isolated teammate workspace does not exist: ${workspace}`,
		);
	const owner = options.db
		.list_sessions({ include_offline: false })
		.find((session) => resolve(session.cwd) === workspace);
	if (owner)
		throw new Error(
			`Isolated teammate workspace is already owned by active session ${owner.session_id}`,
		);
	return workspace;
}
