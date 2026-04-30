import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	renameSync,
	rmSync,
	statSync,
	writeFileSync,
} from 'node:fs';
import { basename, join, resolve } from 'node:path';

export type TeamMemberRole = 'lead' | 'teammate';
export type TeamMemberStatus =
	| 'idle'
	| 'running'
	| 'running_attached'
	| 'running_orphaned'
	| 'blocked'
	| 'offline';
export type TeamTaskStatus =
	| 'pending'
	| 'in_progress'
	| 'blocked'
	| 'completed'
	| 'cancelled';
export type TeamWorkspaceMode = 'shared' | 'worktree';

export interface TeamConfig {
	version: 1;
	id: string;
	name: string;
	cwd: string;
	created_at: string;
	updated_at: string;
	next_task_id: number;
}

export interface TeamMember {
	name: string;
	role: TeamMemberRole;
	status: TeamMemberStatus;
	cwd?: string;
	model?: string;
	profile?: string;
	session_file?: string;
	pid?: number;
	workspace_mode?: TeamWorkspaceMode;
	worktree_path?: string;
	branch?: string;
	mutating?: boolean;
	last_seen_at: string;
	created_at: string;
	updated_at: string;
}

export interface TeamTask {
	id: string;
	title: string;
	description?: string;
	status: TeamTaskStatus;
	assignee?: string;
	depends_on: string[];
	result?: string;
	created_at: string;
	updated_at: string;
	completed_at?: string;
}

export interface TeamMessage {
	id: string;
	from: string;
	to: string;
	body: string;
	urgent: boolean;
	created_at: string;
	delivered_at?: string;
	read_at?: string;
	acknowledged_at?: string;
}

export interface TeamEvent {
	id: string;
	type: string;
	created_at: string;
	data: unknown;
}

export interface CreateTeamInput {
	name?: string;
	cwd: string;
	lead_name?: string;
}

export interface UpsertMemberInput {
	name: string;
	role?: TeamMemberRole;
	status?: TeamMemberStatus;
	cwd?: string;
	model?: string;
	profile?: string;
	session_file?: string;
	pid?: number;
	workspace_mode?: TeamWorkspaceMode;
	worktree_path?: string;
	branch?: string;
	mutating?: boolean;
}

export interface CreateTaskInput {
	title: string;
	description?: string;
	assignee?: string;
	depends_on?: string[];
	status?: TeamTaskStatus;
}

export interface UpdateTaskInput {
	title?: string;
	description?: string | null;
	status?: TeamTaskStatus;
	assignee?: string | null;
	depends_on?: string[];
	result?: string | null;
}

export interface SendMessageInput {
	from: string;
	to: string;
	body: string;
	urgent?: boolean;
}

export interface TeamStatus {
	team: TeamConfig;
	members: TeamMember[];
	tasks: TeamTask[];
	counts: Record<TeamTaskStatus, number>;
}

function now(): string {
	return new Date().toISOString();
}

function random_suffix(): string {
	return Math.random().toString(36).slice(2, 8);
}

function safe_segment(value: string): string {
	const sanitized = value
		.trim()
		.replace(/[^a-zA-Z0-9_.-]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.slice(0, 80);
	if (!sanitized || sanitized === '.' || sanitized === '..') {
		throw new Error('Expected a file-safe non-empty id');
	}
	return sanitized;
}

function normalize_member_name(
	value: string | undefined,
	field = 'member',
): string | undefined {
	const trimmed = value?.trim();
	if (!trimmed) return undefined;
	if (safe_segment(trimmed) !== trimmed) {
		throw new Error(
			`${field} must contain only letters, numbers, dots, underscores, and hyphens`,
		);
	}
	return trimmed;
}

function require_member_name(
	value: string,
	field = 'member',
): string {
	const normalized = normalize_member_name(value, field);
	if (!normalized) throw new Error(`${field} is required`);
	return normalized;
}

function read_json<T>(path: string): T {
	return JSON.parse(readFileSync(path, 'utf-8')) as T;
}

function quarantine_invalid_json(path: string): void {
	const target = `${path}.invalid-${Date.now()}-${random_suffix()}`;
	try {
		renameSync(path, target);
	} catch {
		rmSync(path, { force: true });
	}
}

function read_listed_json<T>(
	path: string,
	validate?: (value: T) => void,
): T | undefined {
	try {
		const value = read_json<T>(path);
		validate?.(value);
		return value;
	} catch {
		quarantine_invalid_json(path);
		return undefined;
	}
}

function write_json(path: string, value: unknown): void {
	mkdirSync(resolve(path, '..'), { recursive: true, mode: 0o700 });
	const tmp = `${path}.tmp-${process.pid}-${Date.now()}-${random_suffix()}`;
	writeFileSync(tmp, JSON.stringify(value, null, '\t') + '\n', {
		mode: 0o600,
	});
	renameSync(tmp, path);
}

function list_json_files<T>(
	dir: string,
	validate?: (value: T) => void,
): T[] {
	if (!existsSync(dir)) return [];
	return readdirSync(dir, { withFileTypes: true })
		.filter((entry) => entry.isFile() && entry.name.endsWith('.json'))
		.sort((a, b) => a.name.localeCompare(b.name))
		.flatMap((entry) => {
			const value = read_listed_json<T>(
				join(dir, entry.name),
				validate,
			);
			return value ? [value] : [];
		});
}

function normalize_unique_ids(
	values: string[] | undefined,
): string[] {
	return [
		...new Set(
			(values ?? []).map((value) => value.trim()).filter(Boolean),
		),
	].sort();
}

function validate_member(member: TeamMember): void {
	require_member_name(member.name);
	if (!['lead', 'teammate'].includes(member.role)) {
		throw new Error(`Invalid member role: ${member.role}`);
	}
	if (
		![
			'idle',
			'running',
			'running_attached',
			'running_orphaned',
			'blocked',
			'offline',
		].includes(member.status)
	) {
		throw new Error(`Invalid member status: ${member.status}`);
	}
	if (
		member.workspace_mode &&
		!['shared', 'worktree'].includes(member.workspace_mode)
	) {
		throw new Error(
			`Invalid member workspace mode: ${member.workspace_mode}`,
		);
	}
}

function validate_task(task: TeamTask): void {
	if (safe_segment(task.id) !== task.id) {
		throw new Error(`Invalid task id: ${task.id}`);
	}
	if (!task.title?.trim()) throw new Error('Task title is required');
	if (
		![
			'pending',
			'in_progress',
			'blocked',
			'completed',
			'cancelled',
		].includes(task.status)
	) {
		throw new Error(`Invalid task status: ${task.status}`);
	}
	if (task.assignee) require_member_name(task.assignee, 'assignee');
	if (!Array.isArray(task.depends_on)) {
		throw new Error('Task depends_on must be an array');
	}
	for (const dep_id of task.depends_on) {
		if (safe_segment(dep_id) !== dep_id) {
			throw new Error(`Invalid dependency task id: ${dep_id}`);
		}
	}
}

function validate_message(message: TeamMessage): void {
	if (safe_segment(message.id) !== message.id) {
		throw new Error(`Invalid message id: ${message.id}`);
	}
	require_member_name(message.from, 'from');
	require_member_name(message.to, 'to');
	if (!message.body?.trim())
		throw new Error('Message body is required');
	if (typeof message.urgent !== 'boolean') {
		throw new Error('Message urgent must be boolean');
	}
}

function sleep_sync(ms: number): void {
	const buffer = new SharedArrayBuffer(4);
	const view = new Int32Array(buffer);
	Atomics.wait(view, 0, 0, ms);
}

function is_pid_alive(pid: number | undefined): boolean {
	if (!pid || pid <= 0) return false;
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

const LOCK_STALE_AFTER_MS = 30_000;

interface TeamLockInfo {
	pid: number;
	created_at: string;
}

function read_lock_info(lock: string): TeamLockInfo | undefined {
	try {
		return read_json<TeamLockInfo>(join(lock, 'owner.json'));
	} catch {
		return undefined;
	}
}

function is_lock_stale(lock: string): boolean {
	const info = read_lock_info(lock);
	if (info?.pid) return !is_pid_alive(info.pid);
	try {
		return Date.now() - statSync(lock).mtimeMs > LOCK_STALE_AFTER_MS;
	} catch {
		return false;
	}
}

export class TeamStore {
	readonly root: string;

	constructor(root: string) {
		this.root = resolve(root);
	}

	team_dir(team_id: string): string {
		return join(this.root, safe_segment(team_id));
	}

	private lock_dir(team_id: string): string {
		return join(this.team_dir(team_id), '.lock');
	}

	private with_team_lock<T>(team_id: string, fn: () => T): T {
		const lock = this.lock_dir(team_id);
		let acquired = false;
		for (let attempt = 0; attempt < 250; attempt += 1) {
			try {
				mkdirSync(lock, { mode: 0o700 });
				write_json(join(lock, 'owner.json'), {
					pid: process.pid,
					created_at: now(),
				});
				acquired = true;
				break;
			} catch (error) {
				if (
					!error ||
					typeof error !== 'object' ||
					!('code' in error) ||
					error.code !== 'EEXIST'
				) {
					throw error;
				}
				if (is_lock_stale(lock)) {
					rmSync(lock, { recursive: true, force: true });
					continue;
				}
				sleep_sync(10);
			}
		}
		if (!acquired)
			throw new Error(`Timed out locking team ${team_id}`);
		try {
			return fn();
		} finally {
			rmSync(lock, { recursive: true, force: true });
		}
	}

	config_path(team_id: string): string {
		return join(this.team_dir(team_id), 'config.json');
	}

	members_dir(team_id: string): string {
		return join(this.team_dir(team_id), 'members');
	}

	tasks_dir(team_id: string): string {
		return join(this.team_dir(team_id), 'tasks');
	}

	mailbox_dir(team_id: string, member: string): string {
		return join(
			this.team_dir(team_id),
			'mailboxes',
			require_member_name(member),
		);
	}

	events_path(team_id: string): string {
		return join(this.team_dir(team_id), 'events.jsonl');
	}

	create_team(input: CreateTeamInput): TeamConfig {
		mkdirSync(this.root, { recursive: true, mode: 0o700 });
		const timestamp = now();
		const base_name =
			input.name?.trim() || basename(input.cwd) || 'team';
		const id = `${safe_segment(base_name.toLowerCase())}-${Date.now().toString(36)}-${random_suffix()}`;
		const team: TeamConfig = {
			version: 1,
			id,
			name: base_name,
			cwd: resolve(input.cwd),
			created_at: timestamp,
			updated_at: timestamp,
			next_task_id: 1,
		};

		mkdirSync(this.team_dir(id), { recursive: true, mode: 0o700 });
		mkdirSync(this.members_dir(id), { recursive: true, mode: 0o700 });
		mkdirSync(this.tasks_dir(id), { recursive: true, mode: 0o700 });
		write_json(this.config_path(id), team);
		this.append_event(id, 'team_created', { team });
		this.upsert_member(id, {
			name: input.lead_name ?? 'lead',
			role: 'lead',
			status: 'idle',
			cwd: team.cwd,
		});
		return team;
	}

	list_teams(): TeamConfig[] {
		if (!existsSync(this.root)) return [];
		return readdirSync(this.root, { withFileTypes: true })
			.filter((entry) => entry.isDirectory())
			.map((entry) => join(this.root, entry.name, 'config.json'))
			.filter((path) => existsSync(path))
			.flatMap((path) => {
				const team = read_listed_json<TeamConfig>(path);
				return team ? [team] : [];
			})
			.sort((a, b) =>
				(b.updated_at ?? b.created_at ?? '').localeCompare(
					a.updated_at ?? a.created_at ?? '',
				),
			);
	}

	load_team(team_id: string): TeamConfig {
		const path = this.config_path(team_id);
		if (!existsSync(path))
			throw new Error(`Unknown team: ${team_id}`);
		return read_json<TeamConfig>(path);
	}

	private save_team(team: TeamConfig): void {
		write_json(this.config_path(team.id), team);
	}

	private touch_team_unlocked(team_id: string): void {
		const team = this.load_team(team_id);
		team.updated_at = now();
		this.save_team(team);
	}

	private upsert_member_unlocked(
		team_id: string,
		input: UpsertMemberInput,
	): TeamMember {
		this.load_team(team_id);
		const timestamp = now();
		const name = require_member_name(input.name);
		const path = join(this.members_dir(team_id), `${name}.json`);
		const existing = existsSync(path)
			? read_json<TeamMember>(path)
			: undefined;
		const workspace_mode =
			input.workspace_mode ?? existing?.workspace_mode;
		const worktree_path =
			workspace_mode === 'worktree'
				? (input.worktree_path ?? existing?.worktree_path)
				: undefined;
		const branch =
			workspace_mode === 'worktree'
				? (input.branch ?? existing?.branch)
				: undefined;
		const member: TeamMember = {
			name,
			role: input.role ?? existing?.role ?? 'teammate',
			status: input.status ?? existing?.status ?? 'idle',
			...((input.cwd ?? existing?.cwd)
				? { cwd: input.cwd ?? existing?.cwd }
				: {}),
			...((input.model ?? existing?.model)
				? { model: input.model ?? existing?.model }
				: {}),
			...((input.profile ?? existing?.profile)
				? { profile: input.profile ?? existing?.profile }
				: {}),
			...((input.session_file ?? existing?.session_file)
				? {
						session_file:
							input.session_file ?? existing?.session_file,
					}
				: {}),
			...((input.pid ?? existing?.pid)
				? { pid: input.pid ?? existing?.pid }
				: {}),
			...(workspace_mode ? { workspace_mode: workspace_mode } : {}),
			...(worktree_path ? { worktree_path: worktree_path } : {}),
			...(branch ? { branch } : {}),
			...(input.mutating !== undefined
				? { mutating: input.mutating }
				: existing?.mutating
					? { mutating: existing.mutating }
					: {}),
			last_seen_at: timestamp,
			created_at: existing?.created_at ?? timestamp,
			updated_at: timestamp,
		};
		write_json(path, member);
		this.touch_team_unlocked(team_id);
		this.append_event(
			team_id,
			existing ? 'member_updated' : 'member_joined',
			{ member },
		);
		return member;
	}

	upsert_member(
		team_id: string,
		input: UpsertMemberInput,
	): TeamMember {
		return this.with_team_lock(team_id, () =>
			this.upsert_member_unlocked(team_id, input),
		);
	}

	list_members(team_id: string): TeamMember[] {
		this.load_team(team_id);
		return list_json_files<TeamMember>(
			this.members_dir(team_id),
			validate_member,
		);
	}

	refresh_member_process_statuses(
		team_id: string,
		attached_members: ReadonlySet<string> = new Set(),
	): TeamMember[] {
		return this.with_team_lock(team_id, () => {
			const members = this.list_members(team_id);
			for (const member of members) {
				if (!member.pid || member.status === 'offline') continue;

				if (is_pid_alive(member.pid)) {
					if (member.role !== 'teammate') continue;
					const attached = attached_members.has(member.name);
					const should_mark_attached =
						attached &&
						(member.status === 'running' ||
							member.status === 'running_attached' ||
							member.status === 'running_orphaned');
					const next_status = attached
						? should_mark_attached
							? 'running_attached'
							: member.status
						: 'running_orphaned';
					if (next_status !== member.status) {
						this.upsert_member_unlocked(team_id, {
							name: member.name,
							status: next_status,
						});
					}
					continue;
				}

				this.upsert_member_unlocked(team_id, {
					name: member.name,
					status: 'offline',
				});
				for (const task of this.list_tasks(team_id)) {
					if (
						task.status !== 'in_progress' ||
						task.assignee !== member.name
					) {
						continue;
					}
					this.update_task_unlocked(team_id, task.id, {
						status: 'blocked',
						result: `Blocked because teammate ${member.name} went offline.`,
					});
				}
			}
			return this.list_members(team_id);
		});
	}

	create_task(team_id: string, input: CreateTaskInput): TeamTask {
		return this.with_team_lock(team_id, () => {
			const title = input.title.trim();
			if (!title) throw new Error('Task title is required');
			const team = this.load_team(team_id);
			const timestamp = now();
			const id = String(team.next_task_id);
			const depends_on = this.validate_task_dependencies(
				team_id,
				id,
				input.depends_on,
			);
			const assignee = normalize_member_name(
				input.assignee,
				'assignee',
			);
			team.next_task_id += 1;
			team.updated_at = timestamp;
			const task: TeamTask = {
				id,
				title,
				...(input.description?.trim()
					? { description: input.description.trim() }
					: {}),
				status: input.status ?? 'pending',
				...(assignee ? { assignee } : {}),
				depends_on: depends_on,
				created_at: timestamp,
				updated_at: timestamp,
			};
			write_json(join(this.tasks_dir(team_id), `${id}.json`), task);
			this.save_team(team);
			this.append_event(team_id, 'task_created', { task });
			return task;
		});
	}

	list_tasks(team_id: string): TeamTask[] {
		this.load_team(team_id);
		return list_json_files<TeamTask>(
			this.tasks_dir(team_id),
			validate_task,
		).sort((a, b) => Number(a.id) - Number(b.id));
	}

	load_task(team_id: string, task_id: string): TeamTask {
		const id = safe_segment(task_id);
		const path = join(this.tasks_dir(team_id), `${id}.json`);
		if (!existsSync(path))
			throw new Error(`Unknown task: ${task_id}`);
		return read_json<TeamTask>(path);
	}

	private validate_task_dependencies(
		team_id: string,
		task_id: string,
		depends_on: string[] | undefined,
	): string[] {
		const normalized = normalize_unique_ids(depends_on);
		if (normalized.includes(task_id)) {
			throw new Error(`Task #${task_id} cannot depend on itself`);
		}

		const tasks = new Map(
			this.list_tasks(team_id).map((task) => [task.id, task]),
		);
		for (const dep_id of normalized) {
			if (!tasks.has(dep_id)) {
				throw new Error(`Unknown dependency task: ${dep_id}`);
			}
		}

		const reaches_task = (
			current_id: string,
			seen = new Set<string>(),
		): boolean => {
			if (current_id === task_id) return true;
			if (seen.has(current_id)) return false;
			seen.add(current_id);
			const current = tasks.get(current_id);
			if (!current) return false;
			return current.depends_on.some((dep_id) =>
				reaches_task(dep_id, seen),
			);
		};

		for (const dep_id of normalized) {
			if (reaches_task(dep_id)) {
				throw new Error(
					`Task dependency cycle detected for #${task_id}`,
				);
			}
		}
		return normalized;
	}

	private update_task_unlocked(
		team_id: string,
		task_id: string,
		input: UpdateTaskInput,
	): TeamTask {
		const task = this.load_task(team_id, task_id);
		const timestamp = now();
		if (input.title !== undefined) {
			const title = input.title.trim();
			if (!title) throw new Error('Task title is required');
			task.title = title;
		}
		if (input.description !== undefined) {
			if (input.description === null || !input.description.trim()) {
				delete task.description;
			} else {
				task.description = input.description.trim();
			}
		}
		if (input.status !== undefined) {
			task.status = input.status;
			if (input.status === 'completed') task.completed_at = timestamp;
			else delete task.completed_at;
		}
		if (input.assignee !== undefined) {
			if (input.assignee === null || !input.assignee.trim())
				delete task.assignee;
			else
				task.assignee = require_member_name(
					input.assignee,
					'assignee',
				);
		}
		if (input.depends_on !== undefined) {
			task.depends_on = this.validate_task_dependencies(
				team_id,
				task.id,
				input.depends_on,
			);
		}
		if (input.result !== undefined) {
			if (input.result === null || !input.result.trim())
				delete task.result;
			else task.result = input.result.trim();
		}
		task.updated_at = timestamp;
		write_json(
			join(this.tasks_dir(team_id), `${safe_segment(task_id)}.json`),
			task,
		);
		this.touch_team_unlocked(team_id);
		this.append_event(team_id, 'task_updated', { task });
		return task;
	}

	update_task(
		team_id: string,
		task_id: string,
		input: UpdateTaskInput,
	): TeamTask {
		return this.with_team_lock(team_id, () =>
			this.update_task_unlocked(team_id, task_id, input),
		);
	}

	is_task_ready(team_id: string, task: TeamTask): boolean {
		if (task.status !== 'pending') return false;
		const tasks = new Map(
			this.list_tasks(team_id).map((item) => [item.id, item]),
		);
		return task.depends_on.every(
			(dep_id) => tasks.get(dep_id)?.status === 'completed',
		);
	}

	claim_next_task(
		team_id: string,
		assignee: string,
	): TeamTask | undefined {
		return this.with_team_lock(team_id, () => {
			const normalized_assignee = require_member_name(
				assignee,
				'assignee',
			);
			const tasks = this.list_tasks(team_id);
			const by_id = new Map(tasks.map((task) => [task.id, task]));
			const candidates = tasks.filter(
				(task) =>
					task.status === 'pending' &&
					(!task.assignee || task.assignee === normalized_assignee) &&
					task.depends_on.every(
						(dep_id) => by_id.get(dep_id)?.status === 'completed',
					),
			);
			const ready =
				candidates.find(
					(task) => task.assignee === normalized_assignee,
				) ?? candidates[0];
			if (!ready) return undefined;
			return this.update_task_unlocked(team_id, ready.id, {
				status: 'in_progress',
				assignee: normalized_assignee,
			});
		});
	}

	send_message(
		team_id: string,
		input: SendMessageInput,
	): TeamMessage {
		return this.with_team_lock(team_id, () => {
			if (!input.body.trim())
				throw new Error('Message body is required');
			this.load_team(team_id);
			const timestamp = now();
			const from = require_member_name(input.from, 'from');
			const to = require_member_name(input.to, 'to');
			const message: TeamMessage = {
				id: `${Date.now().toString(36)}-${random_suffix()}`,
				from,
				to,
				body: input.body.trim(),
				urgent: input.urgent ?? false,
				created_at: timestamp,
			};
			write_json(
				join(this.mailbox_dir(team_id, to), `${message.id}.json`),
				message,
			);
			this.touch_team_unlocked(team_id);
			this.append_event(team_id, 'message_sent', { message });
			return message;
		});
	}

	list_messages(team_id: string, member: string): TeamMessage[] {
		this.load_team(team_id);
		return list_json_files<TeamMessage>(
			this.mailbox_dir(team_id, require_member_name(member)),
			validate_message,
		);
	}

	mark_messages_delivered(
		team_id: string,
		member: string,
		message_ids?: string[],
	): TeamMessage[] {
		return this.update_messages(
			team_id,
			member,
			message_ids,
			(message, timestamp) => {
				if (!message.delivered_at) message.delivered_at = timestamp;
			},
		);
	}

	mark_messages_read(
		team_id: string,
		member: string,
		message_ids?: string[],
	): TeamMessage[] {
		return this.update_messages(
			team_id,
			member,
			message_ids,
			(message, timestamp) => {
				if (!message.delivered_at) message.delivered_at = timestamp;
				if (!message.read_at) message.read_at = timestamp;
			},
		);
	}

	acknowledge_messages(
		team_id: string,
		member: string,
		message_ids?: string[],
	): TeamMessage[] {
		return this.update_messages(
			team_id,
			member,
			message_ids,
			(message, timestamp) => {
				if (!message.delivered_at) message.delivered_at = timestamp;
				if (!message.read_at) message.read_at = timestamp;
				if (!message.acknowledged_at)
					message.acknowledged_at = timestamp;
			},
		);
	}

	clear_unacknowledged_deliveries(
		team_id: string,
		member: string,
	): TeamMessage[] {
		return this.update_messages(
			team_id,
			member,
			undefined,
			(message) => {
				if (message.acknowledged_at || !message.delivered_at) return;
				delete message.delivered_at;
			},
		);
	}

	private update_messages(
		team_id: string,
		member: string,
		message_ids: string[] | undefined,
		update: (message: TeamMessage, timestamp: string) => void,
	): TeamMessage[] {
		return this.with_team_lock(team_id, () => {
			const normalized_member = require_member_name(member);
			const id_filter = message_ids
				? new Set(message_ids.map((id) => safe_segment(id)))
				: undefined;
			const messages = this.list_messages(team_id, normalized_member);
			const timestamp = now();
			for (const message of messages) {
				if (id_filter && !id_filter.has(message.id)) continue;
				const before = JSON.stringify(message);
				update(message, timestamp);
				if (JSON.stringify(message) === before) continue;
				write_json(
					join(
						this.mailbox_dir(team_id, normalized_member),
						`${message.id}.json`,
					),
					message,
				);
			}
			return messages;
		});
	}

	get_status(
		team_id: string,
		attached_members: ReadonlySet<string> = new Set(),
	): TeamStatus {
		this.refresh_member_process_statuses(team_id, attached_members);
		const team = this.load_team(team_id);
		const members = this.list_members(team_id);
		const tasks = this.list_tasks(team_id);
		const counts: Record<TeamTaskStatus, number> = {
			pending: 0,
			in_progress: 0,
			blocked: 0,
			completed: 0,
			cancelled: 0,
		};
		for (const task of tasks) counts[task.status] += 1;
		return { team, members, tasks, counts };
	}

	append_event(
		team_id: string,
		type: string,
		data: unknown,
	): TeamEvent {
		const event: TeamEvent = {
			id: `${Date.now().toString(36)}-${random_suffix()}`,
			type,
			created_at: now(),
			data,
		};
		mkdirSync(this.team_dir(team_id), {
			recursive: true,
			mode: 0o700,
		});
		writeFileSync(
			this.events_path(team_id),
			JSON.stringify(event) + '\n',
			{
				flag: 'a',
				mode: 0o600,
			},
		);
		return event;
	}
}
