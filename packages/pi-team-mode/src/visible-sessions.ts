import { SessionManager } from '@earendil-works/pi-coding-agent';
import { spawn } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import {
	AUTO_INJECT_ENV,
	TEAM_MEMBER_ENV,
	TEAM_ROLE_ENV,
} from './config.js';
import type { TeamDatabase } from './db/index.js';

const CUSTOM_TYPE = 'pi-team-mode:coordination';

export interface CreateVisibleTeammateOptions {
	cwd: string;
	session_dir: string;
	lead_session_id: string;
	lead_session_file?: string;
	name: string;
	instructions?: string;
	role?: 'lead' | 'teammate' | 'peer';
	team_id?: string;
}

function flush_session_file(session: SessionManager): void {
	const session_file = session.getSessionFile();
	if (!session_file) return;
	writeFileSync(
		session_file,
		[session.getHeader(), ...session.getEntries()]
			.map((entry) => JSON.stringify(entry))
			.join('\n') + '\n',
	);
}

export function append_visible_team_message(
	session_file: string | undefined,
	session_dir: string | undefined,
	cwd: string,
	content: string,
	details: Record<string, unknown>,
): string | undefined {
	if (!session_file || !existsSync(session_file)) return undefined;
	const session = SessionManager.open(session_file, session_dir, cwd);
	const entry_id = session.appendCustomMessageEntry(
		CUSTOM_TYPE,
		content,
		true,
		details,
	);
	flush_session_file(session);
	return entry_id;
}

export async function wake_visible_teammate_session(options: {
	session_file?: string;
	cwd: string;
	message: string;
	from_session_id: string;
	message_id?: string;
	member?: string;
	timeout_ms?: number;
}): Promise<void> {
	const session_file = options.session_file;
	const cli = process.argv[1];
	if (!session_file || !cli) return;
	await new Promise<void>((resolve) => {
		const prompt = [
			`You received Team Mode coordination message ${options.message_id ?? '(unrecorded)'} from session ${options.from_session_id}.`,
			'Handle it now inside this normal resumable Pi session.',
			'If the sender asks for any response, send that response back using the team tool action session_send with to set to the sender session id.',
			'Message:',
			options.message,
		].join('\n\n');
		const child = spawn(
			process.execPath,
			[cli, '--session', session_file, '--print', prompt],
			{
				cwd: options.cwd,
				stdio: ['ignore', 'ignore', 'ignore'],
				env: {
					...process.env,
					[AUTO_INJECT_ENV]: 'false',
					[TEAM_ROLE_ENV]: 'teammate',
					[TEAM_MEMBER_ENV]: options.member ?? 'teammate',
				},
			},
		);
		const timer = setTimeout(() => {
			child.kill('SIGTERM');
			resolve();
		}, options.timeout_ms ?? 30_000);
		child.once('exit', () => {
			clearTimeout(timer);
			resolve();
		});
		child.once('error', () => {
			clearTimeout(timer);
			resolve();
		});
	});
}

export function create_visible_teammate_session(
	db: TeamDatabase,
	options: CreateVisibleTeammateOptions,
) {
	const role = options.role ?? 'teammate';
	const session = SessionManager.create(
		options.cwd,
		options.session_dir,
		{
			parentSession: options.lead_session_file,
		},
	);
	session.appendSessionInfo(options.name);
	const session_id = session.getSessionId();
	const intro = [
		`Team Mode created this visible resumable ${role} session from lead ${options.lead_session_id}.`,
		options.team_id ? `Team/group: ${options.team_id}.` : undefined,
		options.instructions,
	]
		.filter(Boolean)
		.join('\n\n');
	session.appendCustomMessageEntry(CUSTOM_TYPE, intro, true, {
		kind: 'teammate_created',
		from_session_id: options.lead_session_id,
		team_id: options.team_id,
		role,
	});
	flush_session_file(session);
	const session_file = session.getSessionFile();
	db.register_session({
		session_id,
		session_file,
		cwd: options.cwd,
		agent_name: options.name,
		role:
			role === 'lead'
				? 'lead'
				: role === 'teammate'
					? 'teammate'
					: 'peer',
		status: 'idle',
		availability: 'available',
		intent: options.instructions,
		session_alias: options.name,
		parent_session_id: options.lead_session_id,
		metadata: {
			created_by: 'team_mode_visible_session',
			lead_session_id: options.lead_session_id,
			team_id: options.team_id,
		},
	});
	return { session_id, session_file, name: options.name, role };
}
