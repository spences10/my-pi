import { SessionManager } from '@earendil-works/pi-coding-agent';
import { spawn } from 'node:child_process';
import { existsSync, writeFileSync } from 'node:fs';
import { create_team_child_env } from './child-env.js';
import {
	AUTO_INJECT_ENV,
	get_coordination_db_path,
	TEAM_MEMBER_ENV,
	TEAM_ROLE_ENV,
} from './config.js';
import type {
	CoordinationSessionRuntime,
	TeamDatabase,
} from './db/index.js';
import {
	sanitize_process_diagnostics,
	type SafeProcessDiagnostics,
} from './diagnostics.js';
import {
	find_session_runtime,
	prompt_runtime,
	wait_for_runtime_ready,
} from './runtime/client.js';
import { start_persistent_runtime } from './runtime/supervisor.js';

const CUSTOM_TYPE = 'pi-team-mode:coordination';
const DEFAULT_WAKE_TIMEOUT_MS = 120_000;
const DIRECT_COMMAND_MAX_BUFFER = 1024 * 1024;
export const TEAM_RUNTIME_ENV = 'MY_PI_TEAM_RUNTIME';

export function should_use_persistent_team_runtime(): boolean {
	return process.env[TEAM_RUNTIME_ENV]?.trim().toLowerCase() === 'persistent';
}

export interface VisibleTeammateWakeResult {
	mode: 'persistent' | 'legacy';
	accepted: boolean;
	method: 'ready' | 'prompt' | 'start' | 'legacy';
	runtime?: CoordinationSessionRuntime;
}

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
	if (should_use_persistent_team_runtime()) return undefined;
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

export function legacy_wake_args(
	cli: string,
	session_file: string,
	coordination_prompt: string,
): string[] {
	return [
		cli,
		'--session',
		session_file,
		'--append-system-prompt',
		coordination_prompt,
		'--print',
	];
}

export async function wake_visible_teammate_session(options: {
	session_file?: string;
	cwd: string;
	message?: string;
	from_session_id: string;
	message_id?: string;
	member?: string;
	role?: 'lead' | 'teammate' | 'peer';
	report_to_session_ids?: string[];
	timeout_ms?: number;
}): Promise<VisibleTeammateWakeResult | undefined> {
	const session_file = options.session_file;
	if (!session_file) return;
	if (should_use_persistent_team_runtime()) {
		const db_path = get_coordination_db_path();
		const session_id = SessionManager.open(
			session_file,
			undefined,
			options.cwd,
		).getSessionId();
		const existing = await find_session_runtime(db_path, session_id);
		if (
			existing &&
			['ready', 'idle', 'running', 'waiting', 'blocked'].includes(
				existing.state,
			)
		) {
			if (!options.message?.trim())
				return {
					mode: 'persistent',
					accepted: true,
					method: 'ready',
					runtime: existing,
				};
			const runtime = await prompt_runtime(
				existing,
				options.message,
				options.timeout_ms,
			);
			return {
				mode: 'persistent',
				accepted: true,
				method: 'prompt',
				runtime,
			};
		}
		if (existing && ['created', 'starting'].includes(existing.state)) {
			const ready = await wait_for_runtime_ready({
				db_path,
				session_id: existing.session_id,
				runtime_id: existing.runtime_id,
				generation: existing.generation,
				timeout_ms: options.timeout_ms,
			});
			if (!options.message?.trim())
				return {
					mode: 'persistent',
					accepted: true,
					method: 'ready',
					runtime: ready,
				};
			const runtime = await prompt_runtime(
				ready,
				options.message,
				options.timeout_ms,
			);
			return {
				mode: 'persistent',
				accepted: true,
				method: 'prompt',
				runtime,
			};
		}
		const runtime = await start_persistent_runtime({
			db_path,
			session_id,
			session_file,
			cwd: options.cwd,
			initial_prompt: options.message,
			member: options.member,
			role: options.role,
			from_session_id: options.from_session_id,
			report_to_session_ids: options.report_to_session_ids,
			timeout_ms: options.timeout_ms,
		});
		return {
			mode: 'persistent',
			accepted: true,
			method: 'start',
			runtime,
		};
	}
	const cli = process.argv[1];
	if (!cli) return;
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
			legacy_wake_args(cli, session_file, coordination_prompt),
			{
				cwd: options.cwd,
				stdio: ['pipe', 'ignore', 'ignore'],
				env: create_team_child_env({
					explicit_env: {
						[AUTO_INJECT_ENV]: 'false',
						[TEAM_ROLE_ENV]: options.role ?? 'teammate',
						[TEAM_MEMBER_ENV]: options.member ?? 'teammate',
					},
				}),
			},
		);
		child.stdin?.end(options.message ?? '');
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
	return {
		mode: 'legacy',
		accepted: true,
		method: 'legacy',
	};
}

export async function run_direct_teammate_command(options: {
	cwd: string;
	command: string;
	timeout_ms?: number;
	member?: string;
	role?: 'lead' | 'teammate' | 'peer';
}): Promise<{
	command: string;
	exit_code: number | null;
	stdout: string;
	stderr: string;
	timed_out: boolean;
	signal?: NodeJS.Signals | null;
	diagnostics: SafeProcessDiagnostics;
}> {
	return await new Promise((resolve) => {
		let stdout = '';
		let stderr = '';
		let timed_out = false;
		let settled = false;
		const child = spawn(process.env.SHELL || '/bin/sh', [], {
			cwd: options.cwd,
			stdio: ['pipe', 'pipe', 'pipe'],
			env: create_team_child_env({
				explicit_env: {
					[TEAM_ROLE_ENV]: options.role ?? 'teammate',
					[TEAM_MEMBER_ENV]: options.member ?? 'teammate',
				},
			}),
		});
		const append = (current: string, chunk: Buffer): string => {
			const next = current + chunk.toString('utf8');
			if (Buffer.byteLength(next) <= DIRECT_COMMAND_MAX_BUFFER)
				return next;
			child.kill('SIGTERM');
			return Buffer.from(next).subarray(0, DIRECT_COMMAND_MAX_BUFFER).toString('utf8');
		};
		child.stdout?.on('data', (chunk: Buffer) => {
			stdout = append(stdout, chunk);
		});
		child.stderr?.on('data', (chunk: Buffer) => {
			stderr = append(stderr, chunk);
		});
		const finish = (
			exit_code: number | null,
			signal?: NodeJS.Signals | null,
		) => {
			if (settled) return;
			settled = true;
			clearTimeout(timer);
			const diagnostics = sanitize_process_diagnostics({
				command: options.command,
				exit_code,
				signal,
				timed_out,
				stdout,
				stderr,
			});
			resolve({
				command: diagnostics.command ?? '',
				exit_code,
				stdout: diagnostics.stdout.text,
				stderr: diagnostics.stderr.text,
				timed_out: diagnostics.timed_out,
				signal: diagnostics.signal,
				diagnostics,
			});
		};
		const timer = setTimeout(() => {
			timed_out = true;
			child.kill('SIGTERM');
		}, options.timeout_ms ?? DEFAULT_WAKE_TIMEOUT_MS);
		child.once('error', (error) => {
			stderr = append(stderr, Buffer.from(error.message));
			finish(1);
		});
		child.once('close', (code, signal) => finish(code, signal));
		child.stdin?.end(options.command);
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
