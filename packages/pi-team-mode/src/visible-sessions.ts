import { SessionManager } from '@earendil-works/pi-coding-agent';
import { exec, spawn } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import {
	AUTO_INJECT_ENV,
	TEAM_MEMBER_ENV,
	TEAM_ROLE_ENV,
} from './config.js';
import type { TeamDatabase } from './db/index.js';

const CUSTOM_TYPE = 'pi-team-mode:coordination';
const DEFAULT_WAKE_TIMEOUT_MS = 120_000;
const DIRECT_COMMAND_MAX_BUFFER = 1024 * 1024;

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
	report_to_session_ids?: string[];
	timeout_ms?: number;
}): Promise<void> {
	const session_file = options.session_file;
	const cli = process.argv[1];
	if (!session_file || !cli) return;
	await new Promise<void>((resolve) => {
		const report_targets = [
			options.from_session_id,
			...(options.report_to_session_ids ?? []),
		]
			.filter(Boolean)
			.filter(
				(session_id, index, list) =>
					list.indexOf(session_id) === index,
			);
		const coordination_prompt = [
			`This prompt was delivered by Team Mode message ${options.message_id ?? '(unrecorded)'} from session ${options.from_session_id}.`,
			'Handle the user prompt normally inside this resumable Pi session.',
			`When you have a final result, send a compact report with team session_send to: ${report_targets.join(', ')}. You may also message any other relevant session id directly if the task needs cross-project coordination.`,
			`If you spawn subordinate teammates, pass reply_to or to=${report_targets.join(',')} so deterministic workers can report directly to the final recipient instead of waiting for a lead relay.`,
			'If you wait on subordinate teammates, do not stop after receiving their result; immediately relay the final result, subordinate session id, blockers, or artifact id to the requested report recipients.',
		].join('\n\n');
		const child = spawn(
			process.execPath,
			[
				cli,
				'--session',
				session_file,
				'--append-system-prompt',
				coordination_prompt,
				'--print',
				options.message,
			],
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
		}, options.timeout_ms ?? DEFAULT_WAKE_TIMEOUT_MS);
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

export async function run_direct_teammate_command(options: {
	cwd: string;
	command: string;
	timeout_ms?: number;
}): Promise<{
	command: string;
	exit_code: number | null;
	stdout: string;
	stderr: string;
	timed_out: boolean;
}> {
	return await new Promise((resolve) => {
		exec(
			options.command,
			{
				cwd: options.cwd,
				timeout: options.timeout_ms ?? DEFAULT_WAKE_TIMEOUT_MS,
				maxBuffer: DIRECT_COMMAND_MAX_BUFFER,
			},
			(error, stdout, stderr) => {
				const exec_error = error as
					| (Error & {
							code?: number | string | null;
							signal?: NodeJS.Signals | null;
							killed?: boolean;
					  })
					| null;
				resolve({
					command: options.command,
					exit_code:
						typeof exec_error?.code === 'number'
							? exec_error.code
							: exec_error
								? 1
								: 0,
					stdout,
					stderr,
					timed_out: exec_error?.killed === true,
				});
			},
		);
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
		status: 'offline',
		availability: 'standby',
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
