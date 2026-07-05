import { create_child_process_env } from '@spences10/pi-child-env';
import { spawn, type ChildProcess } from 'node:child_process';
import {
	ACTIVE_TEAM_ENV,
	COORDINATION_DB_ENV,
	EXTENSION_PATH_ENV,
	HEADLESS_ALIAS_ENV,
	HEADLESS_INTENT_ENV,
	HEADLESS_LAUNCH_ENV,
	HEADLESS_PARENT_SESSION_ENV,
	TEAM_MEMBER_ENV,
	TEAM_ROLE_ENV,
	TEAM_ROOT_ENV,
	TEAM_THINKING_ENV,
} from './config.js';
import type {
	CoordinationSession,
	TeamDatabase,
} from './db/index.js';
import {
	capture_process_identity,
	verify_process_identity,
	type ProcessIdentityVerifier,
	type TeamProcessIdentity,
} from './process-identity.js';

export interface HeadlessSessionOpenOptions {
	alias: string;
	cwd: string;
	parent_session_id: string;
	coordination_db_path: string;
	team_root: string;
	extension_path: string;
	group_id?: string;
	message?: string;
	intent?: string;
	model?: string;
	thinking?: string;
	pi_command?: string;
	timeout_ms?: number;
}

export interface OpenedHeadlessSession {
	session: CoordinationSession;
	resumed: boolean;
	pid?: number;
	command?: string;
	args?: string[];
	process_identity?: TeamProcessIdentity;
}

export interface HeadlessSessionRunner {
	open_or_resume(
		options: HeadlessSessionOpenOptions,
	): Promise<OpenedHeadlessSession>;
}

export interface HeadlessSessionRunnerDeps {
	spawn?: typeof spawn;
	source_env?: NodeJS.ProcessEnv;
	process_identity_verifier?: ProcessIdentityVerifier;
	now?: () => number;
	sleep?: (ms: number) => Promise<void>;
}

interface ResolvedPiCommand {
	command: string;
	args_prefix: string[];
}

const DEFAULT_OPEN_TIMEOUT_MS = 10_000;

export function normalize_headless_alias(alias: string): string {
	const normalized = alias
		.trim()
		.toLowerCase()
		.replace(/[^a-z0-9._-]+/g, '-')
		.replace(/^-+|-+$/g, '');
	if (!normalized) throw new Error('Session alias is required');
	return normalized.slice(0, 80);
}

export function headless_session_id(
	parent_session_id: string,
	alias: string,
): string {
	return `team-${parent_session_id}-${normalize_headless_alias(alias)}`
		.replace(/[^A-Za-z0-9._-]+/g, '-')
		.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '')
		.slice(0, 120);
}

export function resolve_pi_command(
	override?: string,
): ResolvedPiCommand {
	if (override?.trim())
		return { command: override.trim(), args_prefix: [] };
	if (process.argv[1]) {
		return {
			command: process.execPath,
			args_prefix: [process.argv[1]],
		};
	}
	return { command: 'pi', args_prefix: [] };
}

export function build_headless_session_args(options: {
	session_id: string;
	extension_path: string;
	model?: string;
	thinking?: string;
	resume_target?: string;
}): string[] {
	const args = ['--mode', 'rpc'];
	if (options.resume_target)
		args.push('--session', options.resume_target);
	else args.push('--session-id', options.session_id);
	args.push(
		'-e',
		options.extension_path,
		'--name',
		options.session_id,
	);
	if (options.model) args.push('--model', options.model);
	if (options.thinking) args.push('--thinking', options.thinking);
	return args;
}

function observability_env(
	source_env: NodeJS.ProcessEnv,
	group_id: string | undefined,
	alias: string,
): Record<string, string> {
	const env: Record<string, string> = {
		MY_PI_OBSERVABILITY_NAME:
			source_env.MY_PI_OBSERVABILITY_NAME || alias,
		MY_PI_OBSERVABILITY_TAG: [
			source_env.MY_PI_OBSERVABILITY_TAG ||
				source_env.PI_OBSERVABILITY_TAG,
			'team-mode',
			`teammate:${alias}`,
		]
			.filter(Boolean)
			.join(','),
	};
	if (group_id)
		env.MY_PI_OBSERVABILITY_POOL =
			source_env.MY_PI_OBSERVABILITY_POOL || group_id;
	for (const key of [
		'MY_PI_OBSERVABILITY_URL',
		'MY_PI_OBSERVABILITY_TOKEN',
		'MY_PI_OBSERVABILITY_RAW',
		'MY_PI_OBSERVABILITY_DISABLE',
	]) {
		const value = source_env[key];
		if (value) env[key] = value;
	}
	return env;
}

export function create_headless_session_env(
	options: HeadlessSessionOpenOptions,
	session_id: string,
	source_env: NodeJS.ProcessEnv = process.env,
): NodeJS.ProcessEnv {
	const alias = normalize_headless_alias(options.alias);
	return create_child_process_env({
		profile: 'team-mode',
		source_env,
		explicit_env: {
			[TEAM_ROOT_ENV]: options.team_root,
			[COORDINATION_DB_ENV]: options.coordination_db_path,
			[EXTENSION_PATH_ENV]: options.extension_path,
			[TEAM_MEMBER_ENV]: alias,
			[TEAM_ROLE_ENV]: 'teammate',
			[HEADLESS_PARENT_SESSION_ENV]: options.parent_session_id,
			[HEADLESS_ALIAS_ENV]: alias,
			[HEADLESS_LAUNCH_ENV]: 'headless',
			...(options.group_id
				? { [ACTIVE_TEAM_ENV]: options.group_id }
				: {}),
			...(options.intent
				? { [HEADLESS_INTENT_ENV]: options.intent }
				: {}),
			...(options.thinking
				? { [TEAM_THINKING_ENV]: options.thinking }
				: {}),
			MY_PI_HEADLESS_SESSION_ID: session_id,
			...observability_env(source_env, options.group_id, alias),
		},
	});
}

function find_existing_session(
	db: TeamDatabase,
	parent_session_id: string,
	alias: string,
	group_id: string | undefined,
): CoordinationSession | undefined {
	return db
		.list_sessions({ include_offline: true })
		.find((session) => {
			if (session.parent_session_id !== parent_session_id)
				return false;
			if (session.session_alias !== alias) return false;
			if (group_id && session.metadata.group_id !== group_id)
				return false;
			return true;
		});
}

function is_resumable(
	session: CoordinationSession | undefined,
	verifier: ProcessIdentityVerifier,
): boolean {
	if (!session) return false;
	const identity = session.metadata.process_identity as
		| TeamProcessIdentity
		| undefined;
	if (identity) return verify_process_identity(identity, verifier).ok;
	return Boolean(session.pid && verifier.is_alive(session.pid));
}

export class DefaultHeadlessSessionRunner implements HeadlessSessionRunner {
	readonly #db: TeamDatabase;
	readonly #spawn: typeof spawn;
	readonly #source_env: NodeJS.ProcessEnv;
	readonly #verifier: ProcessIdentityVerifier;
	readonly #now: () => number;
	readonly #sleep: (ms: number) => Promise<void>;

	constructor(
		db: TeamDatabase,
		deps: HeadlessSessionRunnerDeps = {},
	) {
		this.#db = db;
		this.#spawn = deps.spawn ?? spawn;
		this.#source_env = deps.source_env ?? process.env;
		this.#verifier = deps.process_identity_verifier ?? {
			capture: capture_process_identity,
			is_alive: (pid) => {
				if (!pid) return false;
				try {
					process.kill(pid, 0);
					return true;
				} catch {
					return false;
				}
			},
			kill: (pid, signal) => process.kill(pid, signal),
		};
		this.#now = deps.now ?? Date.now;
		this.#sleep =
			deps.sleep ??
			((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
	}

	async open_or_resume(
		options: HeadlessSessionOpenOptions,
	): Promise<OpenedHeadlessSession> {
		const alias = normalize_headless_alias(options.alias);
		const existing = find_existing_session(
			this.#db,
			options.parent_session_id,
			alias,
			options.group_id,
		);
		if (existing && is_resumable(existing, this.#verifier)) {
			return { session: existing, resumed: true, pid: existing.pid };
		}
		if (existing)
			this.#db.mark_session_status(existing.session_id, 'offline');

		const session_id =
			existing?.session_id ??
			headless_session_id(options.parent_session_id, alias);
		const resume_target =
			existing?.session_file ?? existing?.session_id;
		const command_info = resolve_pi_command(
			options.pi_command ?? this.#source_env.MY_PI_TEAM_PI_COMMAND,
		);
		const args = [
			...command_info.args_prefix,
			...build_headless_session_args({
				session_id,
				extension_path: options.extension_path,
				model: options.model,
				thinking: options.thinking,
				resume_target,
			}),
		];
		let child: ChildProcess;
		try {
			child = this.#spawn(command_info.command, args, {
				cwd: options.cwd,
				shell: false,
				stdio: ['pipe', 'ignore', 'ignore'],
				env: create_headless_session_env(
					options,
					session_id,
					this.#source_env,
				),
			}) as ChildProcess;
		} catch (error) {
			throw error instanceof Error ? error : new Error(String(error));
		}
		let launch_failure: Error | undefined;
		child.once('error', (error) => {
			launch_failure =
				error instanceof Error ? error : new Error(String(error));
		});
		child.once('exit', (code, signal) => {
			launch_failure ??= new Error(
				`Headless session ${session_id} exited before registration (${code ?? signal ?? 'unknown'})`,
			);
		});
		const process_identity = child.pid
			? this.#verifier.capture(child.pid, {
					marker: session_id,
				})
			: undefined;
		this.#db.register_session({
			session_id,
			cwd: options.cwd,
			agent_name: alias,
			pid: child.pid,
			role: 'teammate',
			status: 'online',
			availability: 'standby',
			intent: options.intent ?? options.message,
			session_alias: alias,
			parent_session_id: options.parent_session_id,
			thinking_level: options.thinking,
			pool: options.group_id ?? 'default',
			tags: ['team-mode', `teammate:${alias}`],
			metadata: {
				headless: true,
				launch_pending: true,
				launch_mode: 'headless',
				group_id: options.group_id,
				alias,
				message: options.message,
				command: command_info.command,
				args,
				process_identity,
			},
		});
		child.on('exit', () => {
			this.#db.mark_session_status(session_id, 'offline');
		});
		const session = await this.#wait_for_session(
			session_id,
			options.timeout_ms ?? DEFAULT_OPEN_TIMEOUT_MS,
			() => launch_failure,
		);
		return {
			session,
			resumed: false,
			pid: child.pid,
			command: command_info.command,
			args,
			process_identity,
		};
	}

	async #wait_for_session(
		session_id: string,
		timeout_ms: number,
		get_launch_failure: () => Error | undefined,
	): Promise<CoordinationSession> {
		const deadline = this.#now() + timeout_ms;
		let session = this.#db.get_session(session_id);
		while (
			(!session || session.metadata.registered_by !== 'child') &&
			this.#now() < deadline
		) {
			const launch_failure = get_launch_failure();
			if (launch_failure) {
				this.#db.mark_session_status(session_id, 'offline');
				throw launch_failure;
			}
			await this.#sleep(100);
			session = this.#db.get_session(session_id);
		}
		if (!session || session.metadata.registered_by !== 'child') {
			this.#db.mark_session_status(session_id, 'offline');
			throw new Error(
				`Timed out waiting for headless session ${session_id} to self-register`,
			);
		}
		const launch_failure = get_launch_failure();
		if (launch_failure) {
			this.#db.mark_session_status(session_id, 'offline');
			throw launch_failure;
		}
		return session;
	}
}
