import { SessionManager } from '@earendil-works/pi-coding-agent';
import { existsSync, readdirSync } from 'node:fs';
import { basename, isAbsolute, join, resolve } from 'node:path';

function resolve_session_file(
	cwd: string,
	session_dir: string | undefined,
	session_ref: string | undefined,
): string | undefined {
	if (!session_ref) return undefined;
	const explicit_path = isAbsolute(session_ref)
		? session_ref
		: resolve(cwd, session_ref);
	if (existsSync(explicit_path)) return explicit_path;
	if (session_ref.endsWith('.jsonl')) return explicit_path;

	const dir = session_dir ? resolve(cwd, session_dir) : undefined;
	if (!dir || !existsSync(dir)) return undefined;
	const matches = readdirSync(dir)
		.filter(
			(file) =>
				file.endsWith('.jsonl') &&
				(basename(file, '.jsonl').endsWith(session_ref) ||
					file.includes(session_ref)),
		)
		.sort();
	const match = matches.at(-1);
	return match ? join(dir, match) : undefined;
}

export function create_session_manager(options: {
	cwd: string;
	session_dir?: string;
	session?: string;
	session_id?: string;
	startup_session_name?: string;
}): SessionManager {
	const resolved_session_dir = options.session_dir
		? resolve(options.cwd, options.session_dir)
		: SessionManager.create(options.cwd).getSessionDir();
	const session_ref = options.session ?? options.session_id;
	const session_file = resolve_session_file(
		options.cwd,
		resolved_session_dir,
		session_ref,
	);
	const session_manager = session_file
		? SessionManager.open(
				session_file,
				resolved_session_dir,
				options.cwd,
			)
		: SessionManager.create(
				options.cwd,
				resolved_session_dir,
				options.session_id ? { id: options.session_id } : {},
			);
	if (
		options.startup_session_name &&
		session_manager.getSessionName() !== options.startup_session_name
	) {
		session_manager.appendSessionInfo(options.startup_session_name);
	}
	return session_manager;
}
