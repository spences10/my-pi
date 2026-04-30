import { StringEnum } from '@mariozechner/pi-ai';
import {
	getAgentDir,
	type BeforeAgentStartEvent,
	type ExtensionAPI,
	type ExtensionCommandContext,
	type ExtensionContext,
} from '@mariozechner/pi-coding-agent';
import {
	Container,
	Key,
	matchesKey,
	Text,
	truncateToWidth,
	type SelectItem,
	type SettingItem,
} from '@mariozechner/pi-tui';
import {
	show_modal,
	show_picker_modal,
	show_settings_modal,
	show_text_modal,
} from '@spences10/pi-tui-modal';
import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Type, type Static } from 'typebox';
import { fake_teammate_step } from './fake-runner.js';
import {
	resolve_teammate_profile,
	type TeammateProfile,
} from './profiles.js';
import { RpcTeammate } from './rpc-runner.js';
import {
	TeamStore,
	type TeamConfig,
	type TeamMember,
	type TeamMessage,
	type TeamStatus,
	type TeamTaskStatus,
	type TeamWorkspaceMode,
} from './store.js';
import { prepare_teammate_workspace } from './workspace.js';

const TEAM_ROOT_ENV = 'MY_PI_TEAM_MODE_ROOT';
const ACTIVE_TEAM_ENV = 'MY_PI_ACTIVE_TEAM_ID';
const TEAM_MEMBER_ENV = 'MY_PI_TEAM_MEMBER';
const TEAM_ROLE_ENV = 'MY_PI_TEAM_ROLE';
const EXTENSION_PATH_ENV = 'MY_PI_TEAM_EXTENSION_PATH';
const AUTO_INJECT_ENV = 'MY_PI_TEAM_AUTO_INJECT_MESSAGES';
const TEAM_UI_ENV = 'MY_PI_TEAM_UI';
const TEAM_UI_STYLE_ENV = 'MY_PI_TEAM_UI_STYLE';
const STATUS_KEY = 'team';

type TeamUiMode = 'auto' | 'compact' | 'full' | 'off';
type TeamUiStyle = 'plain' | 'badge' | 'color';

const TeamAction = StringEnum([
	'team_create',
	'team_list',
	'team_status',
	'team_clear',
	'team_ui',
	'member_upsert',
	'member_spawn',
	'member_prompt',
	'member_follow_up',
	'member_steer',
	'member_shutdown',
	'member_status',
	'member_wait',
	'task_create',
	'task_list',
	'task_get',
	'task_update',
	'task_claim_next',
	'message_send',
	'message_list',
	'message_read',
	'message_ack',
] as const);

const TeamToolParams = Type.Object({
	action: TeamAction,
	team_id: Type.Optional(Type.String()),
	name: Type.Optional(Type.String()),
	member: Type.Optional(Type.String()),
	role: Type.Optional(StringEnum(['lead', 'teammate'] as const)),
	status: Type.Optional(
		StringEnum([
			'idle',
			'running',
			'running_attached',
			'running_orphaned',
			'blocked',
			'offline',
		] as const),
	),
	title: Type.Optional(Type.String()),
	description: Type.Optional(Type.String()),
	task_id: Type.Optional(Type.String()),
	task_status: Type.Optional(
		StringEnum([
			'pending',
			'in_progress',
			'blocked',
			'completed',
			'cancelled',
		] as const),
	),
	assignee: Type.Optional(Type.String()),
	clear_assignee: Type.Optional(Type.Boolean()),
	depends_on: Type.Optional(Type.Array(Type.String())),
	result: Type.Optional(Type.String()),
	clear_result: Type.Optional(Type.Boolean()),
	from: Type.Optional(Type.String()),
	to: Type.Optional(Type.String()),
	message: Type.Optional(Type.String()),
	urgent: Type.Optional(Type.Boolean()),
	initial_prompt: Type.Optional(Type.String()),
	model: Type.Optional(Type.String()),
	thinking: Type.Optional(Type.String()),
	profile: Type.Optional(Type.String()),
	agent: Type.Optional(Type.String()),
	workspace_mode: Type.Optional(
		StringEnum(['shared', 'worktree'] as const),
	),
	branch: Type.Optional(Type.String()),
	worktree_path: Type.Optional(Type.String()),
	mutating: Type.Optional(Type.Boolean()),
	force: Type.Optional(Type.Boolean()),
	timeout_ms: Type.Optional(Type.Number()),
	mode: Type.Optional(
		StringEnum(['auto', 'compact', 'full', 'off'] as const),
	),
	style: Type.Optional(
		StringEnum(['plain', 'badge', 'color'] as const),
	),
});

type TeamToolParams = Static<typeof TeamToolParams>;

function get_team_root(): string {
	return (
		process.env[TEAM_ROOT_ENV] || join(getAgentDir(), 'teams-local')
	);
}

function get_extension_path(): string {
	return (
		process.env[EXTENSION_PATH_ENV] || fileURLToPath(import.meta.url)
	);
}

function should_auto_inject_messages(): boolean {
	const value = process.env[AUTO_INJECT_ENV]?.trim().toLowerCase();
	return !value || !['0', 'false', 'no', 'off'].includes(value);
}

function should_enable_fake_teammate_command(): boolean {
	const value =
		process.env.MY_PI_TEAM_ENABLE_FAKE?.trim().toLowerCase();
	return ['1', 'true', 'yes', 'on'].includes(value ?? '');
}

export function get_team_ui_mode(): TeamUiMode {
	const value = process.env[TEAM_UI_ENV]?.trim().toLowerCase();
	if (!value) return 'compact';
	if (['0', 'false', 'no', 'off', 'hide'].includes(value))
		return 'off';
	if (['full', 'widget', 'on', 'true', '1'].includes(value))
		return 'full';
	if (['auto'].includes(value)) return 'auto';
	return 'compact';
}

export function get_team_ui_style(): TeamUiStyle {
	const value = process.env[TEAM_UI_STYLE_ENV]?.trim().toLowerCase();
	if (!value) return 'plain';
	if (['badge', 'badges', 'icon', 'icons'].includes(value))
		return 'badge';
	if (['color', 'colour', 'colors', 'colours'].includes(value))
		return 'color';
	return 'plain';
}

function get_latest_team_for_cwd(
	store: TeamStore,
	cwd: string,
): TeamConfig | undefined {
	return store.list_teams().find((team) => team.cwd === cwd);
}

export function should_inject_team_prompt(
	event: Pick<BeforeAgentStartEvent, 'systemPromptOptions'>,
): boolean {
	const selected_tools = event.systemPromptOptions?.selectedTools;
	return !selected_tools || selected_tools.includes('team');
}

export function require_lead_for_teammate_spawn(
	own_role: string | undefined,
): void {
	if (own_role?.trim().toLowerCase() !== 'teammate') return;
	throw new Error(
		'Only team leads can spawn teammates. Teammate sessions cannot create nested teams.',
	);
}

function append_team_system_prompt(
	base_prompt: string,
	options: {
		active_team_id?: string;
		ownMember: string;
		ownRole: string;
	},
): string {
	const role_text =
		options.ownRole === 'teammate' ? 'teammate' : 'team lead';
	const active_context = options.active_team_id
		? `You are ${role_text} \`${options.ownMember}\` in team \`${options.active_team_id}\`.`
		: 'No team is active yet. Create one with the `team` tool when the user asks for parallel/background teammate work.';

	return (
		base_prompt +
		`

## Team Mode

${active_context}
Use the \`team\` tool as the source of truth for team coordination.

Rules:
- The team lead should create tasks, spawn members, message teammates, and inspect status through the \`team\` tool.
- Teammates should read messages, acknowledge processed mailbox messages with message_read, claim exactly one ready task, work it, update the task with status/result, then go idle.
- Do not create nested teams from a teammate session; teammate sessions cannot use member_spawn or /team spawn.
- Use urgent steer/follow-up messaging for coordination instead of assuming shared context.
- Team leads should use real RPC teammates via member_spawn for background work.
- For mutating implementation work, prefer member_spawn with workspace_mode=worktree and mutating=true (or /team spawn --worktree --mutating) so teammates do not share the leader cwd.
- Shared-cwd mutating teammates may be refused when another mutating teammate is already active in that cwd.`
	);
}

function require_arg(
	value: string | undefined,
	name: string,
): string {
	const trimmed = value?.trim();
	if (!trimmed) throw new Error(`${name} is required`);
	return trimmed;
}

function format_task_status(status: TeamTaskStatus): string {
	switch (status) {
		case 'pending':
			return '○';
		case 'in_progress':
			return '◐';
		case 'blocked':
			return '!';
		case 'completed':
			return '✓';
		case 'cancelled':
			return '×';
	}
}

function summarize_result(
	result: string | undefined,
): string | undefined {
	const summary = result?.trim().split(/\r?\n/, 1)[0]?.trim();
	if (!summary) return undefined;
	return summary.length > 140
		? `${summary.slice(0, 137)}...`
		: summary;
}

function count_label(
	count: number,
	singular: string,
	plural = `${singular}s`,
): string {
	return `${count} ${count === 1 ? singular : plural}`;
}

function format_status_counts(status: TeamStatus): string {
	const parts = [
		count_label(status.members.length, 'member'),
		count_label(status.tasks.length, 'task'),
	];
	if (status.counts.blocked > 0)
		parts.push(`${status.counts.blocked} needs attention`);
	if (status.counts.in_progress > 0)
		parts.push(`${status.counts.in_progress} running`);
	if (status.counts.pending > 0)
		parts.push(`${status.counts.pending} queued`);
	if (status.tasks.length > 0)
		parts.push(
			`${status.counts.completed}/${status.tasks.length} done`,
		);
	if (status.counts.cancelled > 0)
		parts.push(`${status.counts.cancelled} cancelled`);
	return parts.join(' · ');
}

function format_member_status(
	member: TeamStatus['members'][number],
): string {
	const details: string[] = [];
	if (member.workspace_mode === 'worktree') {
		details.push(
			`worktree${member.branch ? ` ${member.branch}` : ''}${member.worktree_path ? ` at ${member.worktree_path}` : ''}`,
		);
	} else if (member.cwd) {
		details.push(`shared cwd ${member.cwd}`);
	}
	if (member.profile) details.push(`profile ${member.profile}`);
	if (member.mutating) details.push('mutating');
	const suffix = details.length ? `; ${details.join('; ')}` : '';
	switch (member.status) {
		case 'idle':
			return `idle${suffix}`;
		case 'running':
			return `running (legacy control state unknown)${suffix}`;
		case 'running_attached':
			return `running (attached)${suffix}`;
		case 'running_orphaned':
			return `running orphaned (pid ${member.pid ?? 'unknown'}; shutdown can terminate)${suffix}`;
		case 'blocked':
			return `needs attention${suffix}`;
		case 'offline':
			return `offline (not controllable from this session)${suffix}`;
	}
}

function format_task_line(task: TeamStatus['tasks'][number]): string {
	const owner = task.assignee ? ` @${task.assignee}` : '';
	const deps = task.depends_on.length
		? ` waits for #${task.depends_on.join(', #')}`
		: '';
	return `${format_task_status(task.status)} #${task.id}${owner}${deps} ${task.title}`;
}

function format_task_detail(
	task: TeamStatus['tasks'][number],
): string {
	const lines = [format_task_line(task)];
	if (task.description) lines.push('', task.description);
	if (task.result) lines.push('', 'Result', task.result);
	return lines.join('\n');
}

function push_task_group(
	lines: string[],
	label: string,
	tasks: TeamStatus['tasks'],
): void {
	if (tasks.length === 0) return;
	lines.push('', label);
	for (const task of tasks) {
		lines.push(format_task_line(task));
		const result = summarize_result(task.result);
		if (result) lines.push(`  ↳ ${result}`);
	}
}

function format_status(status: TeamStatus): string {
	const lines = [
		`Team ${status.team.name} (${status.team.id})`,
		format_status_counts(status),
	];
	if (status.members.length > 0) {
		lines.push('', 'Members');
		for (const member of status.members) {
			lines.push(
				`- ${member.name} (${member.role}) — ${format_member_status(member)}`,
			);
		}
	}
	if (status.tasks.length === 0) {
		lines.push(
			'',
			'No tasks yet. Add one with /team task add [member:] <title>.',
		);
		return lines.join('\n');
	}

	push_task_group(
		lines,
		'Needs attention',
		status.tasks.filter((task) => task.status === 'blocked'),
	);
	push_task_group(
		lines,
		'Running',
		status.tasks.filter((task) => task.status === 'in_progress'),
	);
	push_task_group(
		lines,
		'Queued',
		status.tasks.filter((task) => task.status === 'pending'),
	);
	push_task_group(
		lines,
		'Done',
		status.tasks.filter((task) => task.status === 'completed'),
	);
	push_task_group(
		lines,
		'Cancelled',
		status.tasks.filter((task) => task.status === 'cancelled'),
	);
	return lines.join('\n');
}

function format_teams_list(
	statuses: TeamStatus[],
	active_team_id: string | undefined,
): string {
	if (statuses.length === 0)
		return 'No teams yet. Create one with /team create [name].';
	const home = process.env.HOME || process.env.USERPROFILE;
	return statuses
		.map((status) => {
			let cwd = status.team.cwd;
			if (home && cwd.startsWith(home))
				cwd = `~${cwd.slice(home.length)}`;
			const marker = status.team.id === active_team_id ? '*' : '-';
			return `${marker} ${status.team.name} (${status.team.id}) — ${format_status_counts(status)} — ${cwd}`;
		})
		.join('\n');
}

function format_messages(messages: TeamMessage[]): string {
	if (messages.length === 0) return 'No messages yet.';
	return messages
		.map((message) => {
			const urgent = message.urgent ? ' urgent' : '';
			const state = message.acknowledged_at
				? 'acknowledged'
				: message.read_at
					? 'read'
					: message.delivered_at
						? 'delivered'
						: 'unread';
			return `- ${message.id}${urgent} ${state} from ${message.from}: ${message.body}`;
		})
		.join('\n');
}

interface SessionUsageSummary {
	session_file: string;
	model?: string;
	assistant_messages: number;
	total_tokens: number;
	total_cost: number;
}

function number_value(value: unknown): number {
	return typeof value === 'number' && Number.isFinite(value)
		? value
		: 0;
}

function format_tokens(tokens: number): string {
	if (tokens >= 1_000_000)
		return `${(tokens / 1_000_000).toFixed(1)}m`;
	if (tokens >= 1_000) return `${(tokens / 1_000).toFixed(1)}k`;
	return String(tokens);
}

function format_cost(cost: number): string {
	if (cost <= 0) return '$0.00';
	return `$${cost.toFixed(cost < 0.01 ? 4 : 2)}`;
}

function read_session_usage(
	session_file: string | undefined,
): SessionUsageSummary | undefined {
	if (!session_file || !existsSync(session_file)) return undefined;
	try {
		const summary: SessionUsageSummary = {
			session_file,
			assistant_messages: 0,
			total_tokens: 0,
			total_cost: 0,
		};
		for (const line of readFileSync(session_file, 'utf8').split(
			/\r?\n/,
		)) {
			if (!line.trim()) continue;
			const entry = JSON.parse(line) as {
				type?: string;
				message?: {
					role?: string;
					model?: string;
					usage?: {
						input?: number;
						output?: number;
						cacheRead?: number;
						cacheWrite?: number;
						totalTokens?: number;
						cost?: {
							input?: number;
							output?: number;
							cacheRead?: number;
							cacheWrite?: number;
							total?: number;
						};
					};
				};
			};
			if (
				entry.type !== 'message' ||
				entry.message?.role !== 'assistant'
			) {
				continue;
			}
			summary.assistant_messages += 1;
			if (entry.message.model) summary.model = entry.message.model;
			const usage = entry.message.usage;
			if (!usage) continue;
			summary.total_tokens +=
				number_value(usage.totalTokens) ||
				number_value(usage.input) +
					number_value(usage.output) +
					number_value(usage.cacheRead) +
					number_value(usage.cacheWrite);
			const cost = usage.cost;
			summary.total_cost += cost
				? number_value(cost.total) ||
					number_value(cost.input) +
						number_value(cost.output) +
						number_value(cost.cacheRead) +
						number_value(cost.cacheWrite)
				: 0;
		}
		return summary;
	} catch {
		return undefined;
	}
}

function collect_team_mailboxes(
	store: TeamStore,
	status: TeamStatus,
): Record<string, TeamMessage[]> {
	const names = new Set(status.members.map((member) => member.name));
	for (const task of status.tasks) {
		if (task.assignee) names.add(task.assignee);
	}
	return Object.fromEntries(
		[...names].sort().map((name) => {
			try {
				return [name, store.list_messages(status.team.id, name)];
			} catch {
				return [name, []];
			}
		}),
	);
}

function collect_session_usage(
	members: TeamMember[],
): Record<string, SessionUsageSummary> {
	return Object.fromEntries(
		members.flatMap((member) => {
			const usage = read_session_usage(member.session_file);
			return usage ? [[member.name, usage]] : [];
		}),
	);
}

function format_member_dashboard_line(
	member: TeamMember,
	usage: SessionUsageSummary | undefined,
): string {
	const details = [member.role, format_member_status(member)];
	const model = member.model ?? usage?.model;
	if (model) details.push(`model ${model}`);
	if (member.pid) details.push(`pid ${member.pid}`);
	if (member.session_file)
		details.push(`transcript ${member.session_file}`);
	if (usage) {
		details.push(`${format_tokens(usage.total_tokens)} tokens`);
		details.push(format_cost(usage.total_cost));
	}
	return `- ${member.name}: ${details.join(' · ')}`;
}

function format_mailbox_dashboard_line(
	name: string,
	messages: TeamMessage[],
): string {
	if (messages.length === 0) return `- ${name}: no messages`;
	const unread = messages.filter(
		(message) => !message.read_at,
	).length;
	const unacknowledged = messages.filter(
		(message) => !message.acknowledged_at,
	).length;
	const urgent = messages.filter(
		(message) => message.urgent && !message.acknowledged_at,
	).length;
	return `- ${name}: ${unacknowledged} unacknowledged · ${unread} unread${urgent ? ` · ${urgent} urgent` : ''}`;
}

function push_dashboard_task_group(
	lines: string[],
	label: string,
	tasks: TeamStatus['tasks'],
): void {
	lines.push('', `${label} (${tasks.length})`);
	if (tasks.length === 0) {
		lines.push('  none');
		return;
	}
	for (const task of tasks) {
		lines.push(`  ${format_task_line(task)}`);
		const result = summarize_result(task.result);
		if (result) lines.push(`    ↳ ${result}`);
	}
}

export function format_completed_task_results(
	status: TeamStatus,
): string {
	const completed = status.tasks.filter(
		(task) => task.status === 'completed',
	);
	if (completed.length === 0) {
		return `No completed team task results for ${status.team.name}.`;
	}
	const lines = [
		`Completed task results for ${status.team.name} (${status.team.id})`,
	];
	for (const task of completed) {
		lines.push(
			'',
			`#${task.id}${task.assignee ? ` @${task.assignee}` : ''} ${task.title}`,
			task.result?.trim() || '(no result recorded)',
		);
	}
	return lines.join('\n');
}

export function format_team_dashboard(
	status: TeamStatus,
	options: {
		team_dir?: string;
		mailboxes?: Record<string, TeamMessage[]>;
		session_usage?: Record<string, SessionUsageSummary>;
	} = {},
): string {
	const lines = [
		`Team dashboard: ${status.team.name} (${status.team.id})`,
		`Repo: ${status.team.cwd}`,
		...(options.team_dir ? [`State: ${options.team_dir}`] : []),
		format_status_counts(status),
	];
	lines.push('', 'Members');
	if (status.members.length === 0) lines.push('  none');
	for (const member of status.members) {
		lines.push(
			format_member_dashboard_line(
				member,
				options.session_usage?.[member.name],
			),
		);
	}

	push_dashboard_task_group(
		lines,
		'Needs attention',
		status.tasks.filter((task) => task.status === 'blocked'),
	);
	push_dashboard_task_group(
		lines,
		'Running',
		status.tasks.filter((task) => task.status === 'in_progress'),
	);
	push_dashboard_task_group(
		lines,
		'Queued',
		status.tasks.filter((task) => task.status === 'pending'),
	);
	push_dashboard_task_group(
		lines,
		'Completed work',
		status.tasks.filter((task) => task.status === 'completed'),
	);

	lines.push('', 'Mailboxes');
	const mailboxes = options.mailboxes ?? {};
	const names = Object.keys(mailboxes).sort();
	if (names.length === 0) lines.push('  none');
	for (const name of names) {
		lines.push(
			format_mailbox_dashboard_line(name, mailboxes[name] ?? []),
		);
	}
	return lines.join('\n');
}

function format_injected_messages(
	member: string,
	messages: TeamMessage[],
): string {
	const lines = [
		`Team mailbox update for ${member}:`,
		'',
		...messages.map((message) => {
			const urgent = message.urgent ? ' urgent' : '';
			return `- ${message.id}${urgent} from ${message.from}: ${message.body}`;
		}),
		'',
		'Use the team tool to update tasks or reply if action is needed.',
		'After handling these messages, acknowledge them with team action message_read for your member.',
	];
	return lines.join('\n');
}

function format_rpc_message(message: TeamMessage): string {
	return `<teammate-message id="${message.id}" from="${message.from}" urgent="${message.urgent}">\n${message.body}\n</teammate-message>\nAfter handling this message, acknowledge it with team action message_read for your member.`;
}

async function deliver_message_to_runner(
	store: TeamStore,
	team_id: string,
	runner: RpcTeammate,
	message: TeamMessage,
): Promise<void> {
	const injected = format_rpc_message(message);
	if (message.urgent) await runner.steer(injected);
	else await runner.follow_up(injected);
	store.mark_messages_delivered(team_id, message.to, [message.id]);
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

async function wait_for_pid_exit(
	pid: number,
	timeout_ms: number,
): Promise<boolean> {
	const deadline = Date.now() + timeout_ms;
	while (Date.now() < deadline) {
		if (!is_pid_alive(pid)) return true;
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
	return !is_pid_alive(pid);
}

async function shutdown_orphaned_member(
	store: TeamStore,
	team_id: string,
	member_name: string,
	timeout_ms = 3_000,
): Promise<TeamMember> {
	store.refresh_member_process_statuses(team_id);
	const member = store
		.list_members(team_id)
		.find((item) => item.name === member_name);
	if (!member) throw new Error(`Unknown teammate: ${member_name}`);
	if (member.role !== 'teammate') {
		throw new Error(
			`Refusing to terminate non-teammate member: ${member_name}`,
		);
	}
	if (!member.pid || member.pid === process.pid) {
		throw new Error(
			`No safe orphaned teammate process to terminate: ${member_name}`,
		);
	}
	if (!is_pid_alive(member.pid)) {
		store.refresh_member_process_statuses(team_id);
		return store
			.list_members(team_id)
			.find((item) => item.name === member_name)!;
	}

	process.kill(member.pid, 'SIGTERM');
	if (!(await wait_for_pid_exit(member.pid, timeout_ms))) {
		process.kill(member.pid, 'SIGKILL');
		await wait_for_pid_exit(member.pid, 1_000);
	}
	store.refresh_member_process_statuses(team_id);
	store.append_event(team_id, 'member_orphan_shutdown', {
		member: member_name,
		pid: member.pid,
	});
	return store
		.list_members(team_id)
		.find((item) => item.name === member_name)!;
}

async function wait_for_orphaned_member(
	store: TeamStore,
	team_id: string,
	member_name: string,
	timeout_ms: number,
): Promise<TeamMember> {
	store.refresh_member_process_statuses(team_id);
	const member = store
		.list_members(team_id)
		.find((item) => item.name === member_name);
	if (!member) throw new Error(`Unknown teammate: ${member_name}`);
	if (!member.pid || !is_pid_alive(member.pid)) {
		store.refresh_member_process_statuses(team_id);
		return store
			.list_members(team_id)
			.find((item) => item.name === member_name)!;
	}
	if (!(await wait_for_pid_exit(member.pid, timeout_ms))) {
		throw new Error(
			`Timed out waiting for orphaned teammate ${member_name} to exit`,
		);
	}
	store.refresh_member_process_statuses(team_id);
	return store
		.list_members(team_id)
		.find((item) => item.name === member_name)!;
}

function teammate_profile(
	cwd: string,
	name: string | undefined,
): TeammateProfile | undefined {
	return resolve_teammate_profile(
		{ cwd, agent_dir: getAgentDir() },
		name,
	);
}

function profile_prompt(
	profile: TeammateProfile | undefined,
	explicit_prompt: string | undefined,
): string {
	return explicit_prompt?.trim() || profile?.prompt || '';
}

function parse_task_add(text: string): {
	assignee?: string;
	title: string;
} {
	const match = text.match(/^([a-zA-Z0-9_.-]+):\s*(.+)$/);
	if (!match) return { title: text.trim() };
	return { assignee: match[1], title: match[2].trim() };
}

interface SpawnRequest {
	member: string;
	prompt: string;
	workspace_mode?: TeamWorkspaceMode;
	branch?: string;
	worktree_path?: string;
	profile?: string;
	mutating?: boolean;
	force?: boolean;
}

function parse_spawn_request(args: string[]): SpawnRequest {
	const [member, ...rest] = args;
	const request: SpawnRequest = {
		member: require_arg(member, 'member'),
		prompt: '',
	};
	const prompt_parts: string[] = [];
	for (let index = 0; index < rest.length; index += 1) {
		const token = rest[index];
		if (token === '--worktree') request.workspace_mode = 'worktree';
		else if (token === '--shared') request.workspace_mode = 'shared';
		else if (token === '--mutating') request.mutating = true;
		else if (token === '--read-only') request.mutating = false;
		else if (token === '--force') request.force = true;
		else if (token === '--branch') {
			request.branch = require_arg(rest[++index], 'branch');
		} else if (token === '--worktree-path') {
			request.worktree_path = require_arg(
				rest[++index],
				'worktree path',
			);
		} else if (token === '--profile' || token === '--agent') {
			request.profile = require_arg(rest[++index], 'profile');
		} else {
			prompt_parts.push(token, ...rest.slice(index + 1));
			break;
		}
	}
	request.prompt = prompt_parts.join(' ').trim();
	return request;
}

export function find_shared_mutating_conflict(
	members: TeamMember[],
	cwd: string,
	member_name: string,
): TeamMember | undefined {
	const resolved_cwd = resolve(cwd);
	return members.find(
		(member) =>
			member.name !== member_name &&
			member.status !== 'offline' &&
			member.mutating === true &&
			member.workspace_mode !== 'worktree' &&
			member.cwd &&
			resolve(member.cwd) === resolved_cwd,
	);
}

function require_no_shared_mutating_conflict(
	store: TeamStore,
	team_id: string,
	cwd: string,
	member_name: string,
	force = false,
	attached_members: ReadonlySet<string> = new Set(),
): void {
	if (force) return;
	const conflict = find_shared_mutating_conflict(
		store.refresh_member_process_statuses(team_id, attached_members),
		cwd,
		member_name,
	);
	if (!conflict) return;
	throw new Error(
		`Refusing to spawn mutating teammate ${member_name} in shared cwd because ${conflict.name} is already using ${cwd}. Use workspace_mode=worktree or --worktree for write isolation.`,
	);
}

function themed(
	ctx: ExtensionContext,
	color: 'accent' | 'dim' | 'muted' | 'warning',
	text: string,
): string {
	try {
		return ctx.ui.theme.fg(color, text);
	} catch {
		return text;
	}
}

function format_team_footer_status(
	status: TeamStatus,
	style: TeamUiStyle,
): string {
	const fragments = [`team:${status.team.name}`];
	if (status.counts.blocked > 0) {
		fragments.push(
			style === 'badge'
				? `! ${status.counts.blocked} attention`
				: `${status.counts.blocked} attention`,
		);
	}
	if (status.counts.in_progress > 0) {
		fragments.push(
			style === 'badge'
				? `◐ ${status.counts.in_progress} running`
				: `${status.counts.in_progress} running`,
		);
	}
	if (status.counts.pending > 0) {
		fragments.push(
			style === 'badge'
				? `○ ${status.counts.pending} queued`
				: `${status.counts.pending} queued`,
		);
	}
	if (status.tasks.length === 0) {
		fragments.push('no tasks');
	} else {
		fragments.push(
			style === 'badge'
				? `✓ ${status.counts.completed}/${status.tasks.length} done`
				: `${status.counts.completed}/${status.tasks.length} done`,
		);
	}
	return fragments.join(' · ');
}

function format_team_widget_lines(
	status: TeamStatus,
	style: TeamUiStyle,
): [string, string] {
	const header = `Team ${status.team.name}: ${status.members.length} member(s), ${status.tasks.length} task(s)`;
	if (style !== 'badge') {
		return [
			header,
			`${status.counts.blocked} attention • ${status.counts.in_progress} running • ${status.counts.pending} queued • ${status.counts.completed} done`,
		];
	}
	return [
		header,
		`! ${status.counts.blocked} attention • ◐ ${status.counts.in_progress} running • ○ ${status.counts.pending} queued • ✓ ${status.counts.completed} done`,
	];
}

function color_team_count(
	theme: ExtensionContext['ui']['theme'],
	style: TeamUiStyle,
	kind: 'pending' | 'running' | 'blocked' | 'done' | 'text',
	text: string,
	active: boolean,
): string {
	if (style !== 'color') return theme.fg('dim', text);
	if (!active) return theme.fg('dim', text);
	switch (kind) {
		case 'pending':
			return theme.fg('warning', text);
		case 'running':
			return theme.fg('accent', text);
		case 'blocked':
			return theme.fg('warning', text);
		case 'done':
			return theme.fg('success', text);
		case 'text':
			return theme.fg('accent', text);
	}
}

function render_team_widget_lines(
	theme: ExtensionContext['ui']['theme'],
	status: TeamStatus,
	style: TeamUiStyle,
): [string, string] {
	const [header, counts] = format_team_widget_lines(status, style);
	if (style !== 'color') {
		return [theme.fg('dim', header), theme.fg('dim', counts)];
	}
	return [
		color_team_count(theme, style, 'text', header, true),
		[
			color_team_count(
				theme,
				style,
				'blocked',
				`${status.counts.blocked} attention`,
				status.counts.blocked > 0,
			),
			color_team_count(
				theme,
				style,
				'running',
				`${status.counts.in_progress} running`,
				status.counts.in_progress > 0,
			),
			color_team_count(
				theme,
				style,
				'pending',
				`${status.counts.pending} queued`,
				status.counts.pending > 0,
			),
			color_team_count(
				theme,
				style,
				'done',
				`${status.counts.completed} done`,
				status.counts.completed > 0,
			),
		].join(theme.fg('dim', ' • ')),
	];
}

export function should_show_team_widget(
	status: TeamStatus,
	mode: TeamUiMode,
): boolean {
	if (mode === 'off' || mode === 'compact') return false;
	const has_actionable_counts =
		status.counts.pending > 0 ||
		status.counts.in_progress > 0 ||
		status.counts.blocked > 0;
	const has_non_idle_teammates = status.members.some(
		(member) => member.role !== 'lead' && member.status !== 'idle',
	);
	if (mode === 'auto') return has_actionable_counts;
	return (
		has_actionable_counts ||
		has_non_idle_teammates ||
		status.tasks.length > 0
	);
}

function attached_member_names(
	runners: Map<string, RpcTeammate>,
): ReadonlySet<string> {
	return new Set(
		[...runners]
			.filter(([, runner]) => runner.is_running)
			.map(([name]) => name),
	);
}

function get_team_status(
	store: TeamStore,
	team_id: string,
	runners: Map<string, RpcTeammate>,
): TeamStatus {
	return store.get_status(team_id, attached_member_names(runners));
}

function get_team_statuses(
	store: TeamStore,
	runners: Map<string, RpcTeammate> = new Map(),
): TeamStatus[] {
	const attached = attached_member_names(runners);
	return store
		.list_teams()
		.map((team) => store.get_status(team.id, attached));
}

async function show_team_switcher(
	ctx: ExtensionCommandContext,
	store: TeamStore,
	active_team_id: string | undefined,
): Promise<string | undefined> {
	const statuses = get_team_statuses(store);
	if (statuses.length === 0) {
		ctx.ui.notify(
			'No teams yet. Create one with /team create [name].',
		);
		return undefined;
	}

	const items: SelectItem[] = statuses.map((status) => ({
		value: status.team.id,
		label: `${status.team.id === active_team_id ? '● ' : ''}${status.team.name}`,
		description: `${format_status_counts(status)} • ${status.team.cwd}`,
	}));
	const active_index = statuses.findIndex(
		(status) => status.team.id === active_team_id,
	);

	return await show_picker_modal(ctx, {
		title: 'Teams',
		subtitle: `${statuses.length} saved team(s)`,
		items,
		initial_index: active_index >= 0 ? active_index : undefined,
		footer: 'enter switches team • esc back',
	});
}

async function show_team_text_modal(
	ctx: ExtensionCommandContext,
	options: {
		title: string;
		subtitle?: string;
		text: string;
	},
): Promise<void> {
	await show_text_modal(ctx, {
		title: options.title,
		subtitle: options.subtitle,
		text: options.text,
		max_visible_lines: 20,
		overlay_options: { width: '90%', minWidth: 72 },
	});
}

function set_team_ui(
	ctx: ExtensionContext,
	store: TeamStore,
	team_id: string | undefined,
	runners: Map<string, RpcTeammate> = new Map(),
): void {
	if (!ctx.hasUI) return;
	if (!team_id || get_team_ui_mode() === 'off') {
		ctx.ui.setStatus(STATUS_KEY, undefined);
		ctx.ui.setWidget(STATUS_KEY, undefined);
		return;
	}
	try {
		const status = get_team_status(store, team_id, runners);
		const style = get_team_ui_style();
		const mode = get_team_ui_mode();
		const show_widget = should_show_team_widget(status, mode);
		const footer =
			mode === 'full' && show_widget
				? `team:${status.team.name}`
				: format_team_footer_status(status, style);
		ctx.ui.setStatus(STATUS_KEY, themed(ctx, 'dim', footer));

		if (!show_widget) {
			ctx.ui.setWidget(STATUS_KEY, undefined);
			return;
		}

		ctx.ui.setWidget(
			STATUS_KEY,
			(_tui, theme) => {
				const container = new Container();
				const [header, counts] = render_team_widget_lines(
					theme,
					status,
					style,
				);
				container.addChild(new Text(header, 0, 0));
				container.addChild(new Text(counts, 0, 0));
				return container;
			},
			{ placement: 'belowEditor' },
		);
	} catch {
		ctx.ui.setStatus(STATUS_KEY, undefined);
		ctx.ui.setWidget(STATUS_KEY, undefined);
	}
}

const TEAM_UI_MODE_VALUES: TeamUiMode[] = [
	'compact',
	'auto',
	'full',
	'off',
];
const TEAM_UI_STYLE_VALUES: TeamUiStyle[] = [
	'plain',
	'badge',
	'color',
];

async function show_team_ui_modal(
	ctx: ExtensionCommandContext,
	store: TeamStore,
	team_id: string | undefined,
): Promise<void> {
	const items: SettingItem[] = [
		{
			id: 'mode',
			label: 'Status UI',
			currentValue: get_team_ui_mode(),
			values: TEAM_UI_MODE_VALUES,
			description:
				'compact keeps team mode in the footer, auto/full show the richer widget when there is useful detail, and off hides team UI for this session.',
		},
		{
			id: 'style',
			label: 'Visual style',
			currentValue: get_team_ui_style(),
			values: TEAM_UI_STYLE_VALUES,
			description:
				'plain is quiet, badge adds semantic icons, and color adds stronger status emphasis.',
		},
	];

	await show_settings_modal(ctx, {
		title: 'Team UI',
		subtitle: () =>
			team_id
				? `Active team ${team_id} • ${format_status_counts(store.get_status(team_id))}`
				: 'No active team • settings apply to this session',
		items,
		metadata: (item) => item?.description,
		footer:
			'enter/space cycles values • changes apply immediately • esc close',
		on_change: (id, new_value) => {
			if (id === 'mode') process.env[TEAM_UI_ENV] = new_value;
			if (id === 'style') process.env[TEAM_UI_STYLE_ENV] = new_value;
			set_team_ui(ctx, store, team_id);
		},
	});
}

async function show_team_home_modal(
	ctx: ExtensionCommandContext,
	store: TeamStore,
	active_team_id: string | undefined,
): Promise<string | undefined> {
	const statuses = get_team_statuses(store);
	const active_status = statuses.find(
		(status) => status.team.id === active_team_id,
	);
	const latest = get_latest_team_for_cwd(store, ctx.cwd);
	const items: SelectItem[] = [];

	if (active_status) {
		items.push(
			{
				value: 'dashboard',
				label: 'Open dashboard',
				description:
					'Members, tasks, mailboxes, transcripts, and usage',
			},
			{
				value: 'results',
				label: 'Summarize completed results',
				description: `${active_status.counts.completed} completed task(s)`,
			},
			{
				value: 'status',
				label: 'Show status',
				description: format_status_counts(active_status),
			},
			{
				value: 'task',
				label: 'Browse tasks',
				description:
					active_status.tasks.length > 0
						? `${active_status.tasks.length} tasks in this team`
						: 'No tasks yet',
			},
			{
				value: 'switch',
				label: 'Switch team',
				description: 'Pick another saved team',
			},
			{
				value: 'ui',
				label: 'Team UI settings',
				description: `Mode ${get_team_ui_mode()} • style ${get_team_ui_style()}`,
			},
			{
				value: 'id',
				label: 'Show team id/path',
				description: active_status.team.id,
			},
			{
				value: 'clear',
				label: 'Detach team UI',
				description: 'Keep state on disk but clear this session view',
			},
		);
	} else {
		items.push({
			value: 'create',
			label: 'Create team',
			description: 'Start a new local team for this repo',
		});
		if (latest) {
			items.push({
				value: 'resume',
				label: 'Resume latest team',
				description: `${latest.name} (${latest.id})`,
			});
		}
		if (statuses.length > 0) {
			items.push({
				value: 'switch',
				label: 'Switch team',
				description: `${statuses.length} saved teams`,
			});
		}
		items.push({
			value: 'ui',
			label: 'Team UI settings',
			description: `Mode ${get_team_ui_mode()} • style ${get_team_ui_style()}`,
		});
	}

	if (statuses.length > 0) {
		items.push({
			value: 'teams',
			label: 'List all teams',
			description: `${statuses.length} teams stored locally`,
		});
	}

	return await show_picker_modal(ctx, {
		title: 'Team mode',
		subtitle: active_status
			? `Active: ${active_status.team.name} • ${format_status_counts(active_status)}`
			: 'No active team',
		items,
		max_visible: Math.min(Math.max(items.length, 6), 10),
		footer: 'enter runs action • esc cancel',
	});
}

async function show_team_task_picker(
	ctx: ExtensionCommandContext,
	status: TeamStatus,
): Promise<string | undefined> {
	const items: SelectItem[] = status.tasks.map((task) => ({
		value: task.id,
		label: `#${task.id} ${task.title}`,
		description: [
			format_task_status(task.status),
			task.status,
			task.assignee ? `@${task.assignee}` : 'unassigned',
			task.depends_on.length
				? `waits for #${task.depends_on.join(', #')}`
				: undefined,
			summarize_result(task.result),
		]
			.filter(Boolean)
			.join(' • '),
	}));

	return await show_picker_modal(ctx, {
		title: 'Team tasks',
		subtitle: `${status.team.name} • ${format_status_counts(status)}`,
		items,
		max_visible: Math.min(Math.max(items.length, 8), 14),
		empty_message: 'No team tasks yet',
		footer: 'enter shows task detail • esc cancel',
	});
}

async function show_team_dashboard_modal(
	ctx: ExtensionCommandContext,
	store: TeamStore,
	status: TeamStatus,
): Promise<'close' | 'results'> {
	const dashboard = format_team_dashboard(status, {
		team_dir: store.team_dir(status.team.id),
		mailboxes: collect_team_mailboxes(store, status),
		session_usage: collect_session_usage(status.members),
	});

	return await show_modal<'close' | 'results'>(
		ctx,
		{
			title: 'Team dashboard',
			subtitle: `${status.team.name} • ${format_status_counts(status)}`,
			footer: 'enter/s summarize completed results • q/esc close',
			overlay_options: { width: '90%', minWidth: 72 },
		},
		({ done }, theme) => ({
			render: (width: number) =>
				dashboard.split('\n').map((line) => {
					const styled = /^[A-Z][^:]+$/.test(line)
						? theme.fg('accent', theme.bold(line))
						: line;
					return truncateToWidth(styled, width);
				}),
			invalidate: () => undefined,
			handleInput: (data: string) => {
				if (matchesKey(data, Key.enter) || data === 's') {
					done('results');
				} else if (matchesKey(data, Key.escape) || data === 'q') {
					done('close');
				}
			},
		}),
	);
}

function present_completed_task_results(
	ctx: ExtensionCommandContext,
	status: TeamStatus,
): void {
	const text = format_completed_task_results(status);
	if (ctx.hasUI && typeof ctx.ui.setEditorText === 'function') {
		ctx.ui.setEditorText(text);
		ctx.ui.notify('Inserted completed team results into the editor.');
		return;
	}
	ctx.ui.notify(text);
}

export async function handle_team_command(
	args: string,
	ctx: ExtensionCommandContext,
	store: TeamStore,
	runners: Map<string, RpcTeammate>,
	get_active_team_id: () => string | undefined,
	set_active_team_id: (team_id: string | undefined) => void,
	own_role = 'lead',
): Promise<void> {
	const trimmed = args.trim();
	if (!trimmed && ctx.hasUI) {
		while (true) {
			const selected = await show_team_home_modal(
				ctx,
				store,
				get_active_team_id(),
			);
			if (!selected) return;
			await handle_team_command(
				selected,
				ctx,
				store,
				runners,
				get_active_team_id,
				set_active_team_id,
				own_role,
			);
		}
	}

	const [sub = 'status', ...rest] = trimmed.split(/\s+/);
	const rest_text = rest.join(' ').trim();

	function current_team_id(): string {
		const team_id = get_active_team_id();
		if (!team_id)
			throw new Error(
				'No active team. Use /team create [name] or /team resume.',
			);
		return team_id;
	}

	try {
		switch (sub) {
			case 'create': {
				const team = store.create_team({
					cwd: ctx.cwd,
					name: rest_text || undefined,
				});
				set_active_team_id(team.id);
				set_team_ui(ctx, store, team.id, runners);
				ctx.ui.notify(`Created team ${team.name} (${team.id})`);
				break;
			}
			case 'id': {
				const team_id = current_team_id();
				const text = `${team_id}\n${store.team_dir(team_id)}`;
				if (ctx.hasUI) {
					await show_team_text_modal(ctx, {
						title: 'Team id/path',
						subtitle: team_id,
						text,
					});
				} else {
					ctx.ui.notify(text);
				}
				break;
			}
			case 'ui': {
				const [ui_arg, style_arg] = rest;
				const mode = rest_text.trim().toLowerCase();
				if (!mode) {
					if (ctx.hasUI) {
						await show_team_ui_modal(
							ctx,
							store,
							get_active_team_id(),
						);
					} else {
						ctx.ui.notify(
							`Team UI mode: ${get_team_ui_mode()}, style: ${get_team_ui_style()}`,
						);
					}
					break;
				}
				if (ui_arg === 'style') {
					const style = style_arg?.trim().toLowerCase();
					if (!style) {
						ctx.ui.notify(`Team UI style: ${get_team_ui_style()}`);
						break;
					}
					if (!['plain', 'badge', 'color'].includes(style)) {
						throw new Error(
							'Usage: /team ui style plain|badge|color',
						);
					}
					process.env[TEAM_UI_STYLE_ENV] = style;
					set_team_ui(ctx, store, get_active_team_id(), runners);
					ctx.ui.notify(`Team UI style: ${style}`);
					break;
				}
				if (!['auto', 'compact', 'full', 'off'].includes(mode)) {
					throw new Error(
						'Usage: /team ui auto|compact|full|off or /team ui style plain|badge|color',
					);
				}
				process.env[TEAM_UI_ENV] = mode;
				set_team_ui(ctx, store, get_active_team_id(), runners);
				ctx.ui.notify(`Team UI mode: ${mode}`);
				break;
			}
			case 'teams': {
				if (ctx.hasUI) {
					const team_id = await show_team_switcher(
						ctx,
						store,
						get_active_team_id(),
					);
					if (team_id) {
						set_active_team_id(team_id);
						set_team_ui(ctx, store, team_id, runners);
						const team = store.load_team(team_id);
						ctx.ui.notify(
							`Switched to team ${team.name} (${team.id})`,
						);
					}
				} else {
					const statuses = get_team_statuses(store, runners);
					ctx.ui.notify(
						format_teams_list(statuses, get_active_team_id()),
					);
				}
				break;
			}
			case 'switch': {
				const team_id = await show_team_switcher(
					ctx,
					store,
					get_active_team_id(),
				);
				if (!team_id) break;
				set_active_team_id(team_id);
				set_team_ui(ctx, store, team_id, runners);
				const team = store.load_team(team_id);
				ctx.ui.notify(`Switched to team ${team.name} (${team.id})`);
				break;
			}
			case 'clear':
			case 'close': {
				set_active_team_id(undefined);
				set_team_ui(ctx, store, undefined, runners);
				ctx.ui.notify('Cleared active team UI');
				break;
			}
			case 'status':
			case 'list': {
				const team_id = current_team_id();
				const status = get_team_status(store, team_id, runners);
				set_team_ui(ctx, store, team_id, runners);
				const text = format_status(status);
				if (ctx.hasUI) {
					await show_team_text_modal(ctx, {
						title: 'Team status',
						subtitle: `${status.team.name} • ${format_status_counts(status)}`,
						text,
					});
				} else {
					ctx.ui.notify(text);
				}
				break;
			}
			case 'dashboard':
			case 'dash': {
				const team_id = current_team_id();
				const status = get_team_status(store, team_id, runners);
				set_team_ui(ctx, store, team_id, runners);
				if (ctx.hasUI) {
					const action = await show_team_dashboard_modal(
						ctx,
						store,
						status,
					);
					if (action === 'results') {
						present_completed_task_results(ctx, status);
					}
				} else {
					ctx.ui.notify(
						format_team_dashboard(status, {
							team_dir: store.team_dir(team_id),
							mailboxes: collect_team_mailboxes(store, status),
							session_usage: collect_session_usage(status.members),
						}),
					);
				}
				break;
			}
			case 'results':
			case 'summary':
			case 'summarize': {
				const team_id = current_team_id();
				present_completed_task_results(
					ctx,
					get_team_status(store, team_id, runners),
				);
				break;
			}
			case 'resume': {
				const team = get_latest_team_for_cwd(store, ctx.cwd);
				if (!team) throw new Error('No previous team for this cwd.');
				set_active_team_id(team.id);
				set_team_ui(ctx, store, team.id, runners);
				ctx.ui.notify(`Resumed team ${team.name} (${team.id})`);
				break;
			}
			case 'member': {
				const [action, name] = rest;
				if (action !== 'add')
					throw new Error('Usage: /team member add <name>');
				const member = store.upsert_member(current_team_id(), {
					name: require_arg(name, 'member name'),
				});
				set_team_ui(ctx, store, get_active_team_id(), runners);
				ctx.ui.notify(`Member ${member.name} ready`);
				break;
			}
			case 'task': {
				const [action, id, ...tail] = rest;
				const team_id = current_team_id();
				if (action === 'add') {
					const parsed = parse_task_add(rest.slice(1).join(' '));
					const task = store.create_task(team_id, parsed);
					set_team_ui(ctx, store, team_id, runners);
					ctx.ui.notify(`Created task #${task.id}: ${task.title}`);
				} else if (action === 'list' || !action) {
					let status = get_team_status(store, team_id, runners);
					if (ctx.hasUI && status.tasks.length > 0) {
						while (true) {
							const task_id = await show_team_task_picker(
								ctx,
								status,
							);
							if (!task_id) break;
							await show_team_text_modal(ctx, {
								title: `Task #${task_id}`,
								subtitle: status.team.name,
								text: format_task_detail(
									store.load_task(team_id, task_id),
								),
							});
							status = get_team_status(store, team_id, runners);
						}
					} else if (ctx.hasUI) {
						await show_team_text_modal(ctx, {
							title: 'Team tasks',
							subtitle: `${status.team.name} • ${format_status_counts(status)}`,
							text: format_status(status),
						});
					} else {
						ctx.ui.notify(format_status(status));
					}
				} else if (action === 'show' || action === 'get') {
					const task_id = require_arg(id, 'task id');
					const text = format_task_detail(
						store.load_task(team_id, task_id),
					);
					if (ctx.hasUI) {
						await show_team_text_modal(ctx, {
							title: `Task #${task_id}`,
							text,
						});
					} else {
						ctx.ui.notify(text);
					}
				} else if (action === 'done') {
					const task = store.update_task(
						team_id,
						require_arg(id, 'task id'),
						{
							status: 'completed',
							result: tail.join(' ') || undefined,
						},
					);
					set_team_ui(ctx, store, team_id, runners);
					ctx.ui.notify(`Completed task #${task.id}`);
				} else if (action === 'block') {
					const task = store.update_task(
						team_id,
						require_arg(id, 'task id'),
						{
							status: 'blocked',
							result: tail.join(' ') || null,
						},
					);
					set_team_ui(ctx, store, team_id, runners);
					ctx.ui.notify(`Blocked task #${task.id}`);
				} else if (action === 'cancel') {
					const task = store.update_task(
						team_id,
						require_arg(id, 'task id'),
						{
							status: 'cancelled',
							result: tail.join(' ') || null,
						},
					);
					set_team_ui(ctx, store, team_id, runners);
					ctx.ui.notify(`Cancelled task #${task.id}`);
				} else if (action === 'reopen') {
					const task = store.update_task(
						team_id,
						require_arg(id, 'task id'),
						{ status: 'pending', result: null },
					);
					set_team_ui(ctx, store, team_id, runners);
					ctx.ui.notify(`Reopened task #${task.id}`);
				} else if (action === 'assign') {
					const task = store.update_task(
						team_id,
						require_arg(id, 'task id'),
						{ assignee: require_arg(tail[0], 'assignee') },
					);
					set_team_ui(ctx, store, team_id, runners);
					ctx.ui.notify(
						`Assigned task #${task.id} to ${task.assignee}`,
					);
				} else if (action === 'unassign') {
					const task = store.update_task(
						team_id,
						require_arg(id, 'task id'),
						{ assignee: null },
					);
					set_team_ui(ctx, store, team_id, runners);
					ctx.ui.notify(`Unassigned task #${task.id}`);
				} else if (action === 'claim') {
					const assignee = require_arg(id, 'assignee');
					const task = store.claim_next_task(team_id, assignee);
					set_team_ui(ctx, store, team_id, runners);
					ctx.ui.notify(
						task
							? `Claimed #${task.id}: ${task.title}`
							: 'No ready pending tasks',
					);
				} else {
					throw new Error(
						'Usage: /team task add|list|show|done|block <id> [reason]|cancel <id> [reason]|reopen <id>|assign <id> <member>|unassign <id>|claim ...',
					);
				}
				break;
			}
			case 'dm': {
				const [to, ...message_parts] = rest;
				const message = store.send_message(current_team_id(), {
					from: 'lead',
					to: require_arg(to, 'recipient'),
					body: message_parts.join(' '),
				});
				const team_id = current_team_id();
				const runner = runners.get(message.to);
				if (runner?.is_running) {
					await deliver_message_to_runner(
						store,
						team_id,
						runner,
						message,
					);
				}
				ctx.ui.notify(`Sent ${message.id} to ${message.to}`);
				break;
			}
			case 'inbox': {
				const member = rest_text || 'lead';
				const text = format_messages(
					store.list_messages(current_team_id(), member),
				);
				if (ctx.hasUI) {
					await show_team_text_modal(ctx, {
						title: `${member} inbox`,
						text,
					});
				} else {
					ctx.ui.notify(text);
				}
				break;
			}
			case 'spawn': {
				require_lead_for_teammate_spawn(own_role);
				const request = parse_spawn_request(rest);
				const profile = teammate_profile(ctx.cwd, request.profile);
				const name = request.member;
				const team_id = current_team_id();
				const current_model = (ctx as ExtensionContext).model;
				const existing = runners.get(name);
				if (existing?.is_running) {
					throw new Error(
						`Teammate ${name} is already running. Use /team shutdown ${name} first.`,
					);
				}
				const workspace = prepare_teammate_workspace({
					team_id,
					member: name,
					repo_cwd: ctx.cwd,
					team_root: get_team_root(),
					mode: request.workspace_mode,
					branch: request.branch,
					worktree_path: request.worktree_path,
				});
				if (
					request.mutating &&
					workspace.workspace_mode === 'shared'
				) {
					require_no_shared_mutating_conflict(
						store,
						team_id,
						workspace.cwd,
						name,
						request.force,
						attached_member_names(runners),
					);
				}
				const runner = new RpcTeammate(store, {
					team_id,
					member: name,
					cwd: workspace.cwd,
					team_root: get_team_root(),
					extension_path: get_extension_path(),
					model:
						profile?.model ??
						(current_model
							? `${current_model.provider}/${current_model.id}`
							: undefined),
					thinking: profile?.thinking,
					system_prompt: profile?.system_prompt,
					tools: profile?.tools,
					skills: profile?.skills,
					profile: profile?.name,
					workspace_mode: workspace.workspace_mode,
					worktree_path: workspace.worktree_path,
					branch: workspace.branch,
					mutating: request.mutating ?? false,
					on_exit: (member) => runners.delete(member),
				});
				runners.set(name, runner);
				try {
					await runner.start();
				} catch (error) {
					runners.delete(name);
					throw error;
				}
				const initial_prompt = profile_prompt(
					profile,
					request.prompt,
				);
				if (initial_prompt) await runner.prompt(initial_prompt);
				set_team_ui(ctx, store, team_id, runners);
				ctx.ui.notify(
					`Spawned teammate ${name}${initial_prompt ? ' and sent prompt' : ''}`,
				);
				break;
			}
			case 'send': {
				const [member, ...message_parts] = rest;
				const name = require_arg(member, 'member');
				const runner = runners.get(name);
				if (!runner?.is_running)
					throw new Error(`No running teammate: ${name}`);
				await runner.prompt(message_parts.join(' '));
				ctx.ui.notify(`Sent prompt to ${name}`);
				break;
			}
			case 'steer': {
				const [member, ...message_parts] = rest;
				const name = require_arg(member, 'member');
				const runner = runners.get(name);
				if (!runner?.is_running)
					throw new Error(`No running teammate: ${name}`);
				await runner.steer(message_parts.join(' '));
				ctx.ui.notify(`Steered ${name}`);
				break;
			}
			case 'shutdown': {
				const [member, ...reason_parts] = rest;
				const name = require_arg(member, 'member');
				const runner = runners.get(name);
				if (runner?.is_running) {
					await runner.shutdown(reason_parts.join(' ') || undefined);
					runners.delete(name);
					store.upsert_member(current_team_id(), {
						name,
						status: 'offline',
					});
					ctx.ui.notify(`Shutdown requested for ${name}`);
				} else {
					const member = await shutdown_orphaned_member(
						store,
						current_team_id(),
						name,
					);
					ctx.ui.notify(
						`Terminated orphaned teammate ${name}; status ${member.status}`,
					);
				}
				set_team_ui(ctx, store, get_active_team_id(), runners);
				break;
			}
			case 'wait': {
				const [member] = rest;
				const name = require_arg(member, 'member');
				const runner = runners.get(name);
				if (runner?.is_running) await runner.wait_for_idle();
				else
					await wait_for_orphaned_member(
						store,
						current_team_id(),
						name,
						120_000,
					);
				set_team_ui(ctx, store, get_active_team_id(), runners);
				const status = get_team_status(
					store,
					current_team_id(),
					runners,
				);
				const text = format_status(status);
				if (ctx.hasUI) {
					await show_team_text_modal(ctx, {
						title: 'Team status',
						subtitle: `${status.team.name} • ${format_status_counts(status)}`,
						text,
					});
				} else {
					ctx.ui.notify(text);
				}
				break;
			}
			case 'fake': {
				if (!should_enable_fake_teammate_command()) {
					throw new Error(
						'Fake teammate runner is disabled. Set MY_PI_TEAM_ENABLE_FAKE=1 for local tests.',
					);
				}
				const [member = 'alice', ...flags] = rest;
				const result = fake_teammate_step(
					store,
					current_team_id(),
					member,
					{
						complete: !flags.includes('--hold'),
						shutdownOnMessage: flags.includes(
							'--shutdown-on-message',
						),
					},
				);
				set_team_ui(ctx, store, get_active_team_id(), runners);
				ctx.ui.notify(result.summary);
				break;
			}
			default:
				ctx.ui.notify(
					[
						'Team commands:',
						'/team create [name] — start a team for this repo',
						'/team status — show members and task progress',
						'/team dashboard — inspect members, tasks, mailboxes, transcripts, and usage',
						'/team results — collect completed task results into one summary',
						'/team spawn <member> [--worktree] [--mutating] [--branch name] [prompt] — start a teammate',
						'/team task add [member:] <title> — queue work',
						'/team task show <id> — show full task details/result',
						'/team task block|cancel <id> [reason] — mark blocked/cancelled and replace the result note',
						'/team task reopen <id> — move back to pending and clear the result note',
						'/team task assign <id> <member> / unassign <id> — change owner without changing status',
						'/team dm <member> <message> — send a mailbox message',
						'/team wait|shutdown <member> — control a teammate',
						'/team teams|switch|resume|clear — manage active team UI',
					].join('\n'),
					'warning',
				);
		}
	} catch (error) {
		ctx.ui.notify(
			error instanceof Error ? error.message : String(error),
			'warning',
		);
	}
}

export default async function team_mode(pi: ExtensionAPI) {
	const store = new TeamStore(get_team_root());
	const runners = new Map<string, RpcTeammate>();
	let active_team_id: string | undefined;
	let mailbox_timer: NodeJS.Timeout | undefined;
	let observed_team_id: string | undefined;
	let observed_completed_task_ids = new Set<string>();
	let observed_blocked_task_ids = new Set<string>();
	const own_member = process.env[TEAM_MEMBER_ENV] || 'lead';
	const own_role = process.env[TEAM_ROLE_ENV] || 'lead';

	function stop_mailbox_watcher(): void {
		if (!mailbox_timer) return;
		clearInterval(mailbox_timer);
		mailbox_timer = undefined;
	}

	function reset_completed_task_observer(
		team_id: string | undefined,
	): void {
		observed_team_id = team_id;
		const tasks = team_id ? store.list_tasks(team_id) : [];
		observed_completed_task_ids = new Set(
			tasks
				.filter((task) => task.status === 'completed')
				.map((task) => task.id),
		);
		observed_blocked_task_ids = new Set(
			tasks
				.filter((task) => task.status === 'blocked')
				.map((task) => task.id),
		);
	}

	function poll_team_activity(ctx: ExtensionContext): void {
		if (!active_team_id) {
			set_team_ui(ctx, store, undefined, runners);
			return;
		}
		try {
			if (observed_team_id !== active_team_id) {
				reset_completed_task_observer(active_team_id);
			}
			const status = get_team_status(store, active_team_id, runners);
			set_team_ui(ctx, store, active_team_id, runners);
			if (own_role !== 'teammate') {
				for (const task of status.tasks) {
					if (
						task.status === 'completed' &&
						!observed_completed_task_ids.has(task.id)
					) {
						observed_completed_task_ids.add(task.id);
						const result = summarize_result(task.result);
						ctx.ui.notify(
							`Team task #${task.id} completed${task.assignee ? ` by ${task.assignee}` : ''}: ${task.title}${result ? ` — ${result}` : ''}`,
							'info',
						);
					}
					if (
						task.status === 'blocked' &&
						!observed_blocked_task_ids.has(task.id)
					) {
						observed_blocked_task_ids.add(task.id);
						const result = summarize_result(task.result);
						ctx.ui.notify(
							`Team task #${task.id} blocked${task.assignee ? ` for ${task.assignee}` : ''}: ${task.title}${result ? ` — ${result}` : ''}`,
							'warning',
						);
					}
				}
			}
			if (!should_auto_inject_messages()) return;
			const unread = store
				.list_messages(active_team_id, own_member)
				.filter(
					(message) =>
						!message.acknowledged_at && !message.delivered_at,
				);
			if (unread.length === 0) return;
			pi.sendMessage(
				{
					customType: 'team-message',
					content: format_injected_messages(own_member, unread),
					display: true,
					details: { team_id: active_team_id, messages: unread },
				},
				{ deliverAs: 'followUp', triggerTurn: true },
			);
			store.mark_messages_delivered(
				active_team_id,
				own_member,
				unread.map((message) => message.id),
			);
		} catch (error) {
			try {
				store.load_team(active_team_id);
				store.append_event(
					active_team_id,
					'team_activity_poll_error',
					{
						member: own_member,
						error:
							error instanceof Error ? error.message : String(error),
					},
				);
			} catch {
				active_team_id = undefined;
				reset_completed_task_observer(undefined);
				set_team_ui(ctx, store, undefined, runners);
			}
		}
	}

	function start_mailbox_watcher(ctx: ExtensionContext): void {
		stop_mailbox_watcher();
		mailbox_timer = setInterval(() => poll_team_activity(ctx), 1000);
		mailbox_timer.unref();
	}

	pi.on('session_start', async (_event, ctx) => {
		active_team_id = process.env[ACTIVE_TEAM_ENV];
		if (active_team_id) {
			try {
				store.load_team(active_team_id);
				store.clear_unacknowledged_deliveries(
					active_team_id,
					own_member,
				);
				store.upsert_member(active_team_id, {
					name: own_member,
					role: own_role === 'teammate' ? 'teammate' : 'lead',
					status: 'idle',
					cwd: ctx.cwd,
					pid: process.pid,
				});
			} catch {
				active_team_id = undefined;
			}
		}
		reset_completed_task_observer(active_team_id);
		set_team_ui(ctx, store, active_team_id, runners);
		start_mailbox_watcher(ctx);
		poll_team_activity(ctx);
	});

	pi.on('session_shutdown', async (_event, ctx) => {
		for (const runner of runners.values()) {
			await runner
				.shutdown('leader session shutting down')
				.catch(() => undefined);
		}
		if (active_team_id) {
			try {
				store.clear_unacknowledged_deliveries(
					active_team_id,
					own_member,
				);
			} catch {
				// Ignore shutdown cleanup failures.
			}
		}
		runners.clear();
		stop_mailbox_watcher();
		ctx.ui.setStatus(STATUS_KEY, undefined);
		ctx.ui.setWidget(STATUS_KEY, undefined);
	});

	pi.on('before_agent_start', async (event) => {
		if (!should_inject_team_prompt(event)) return {};
		return {
			systemPrompt: append_team_system_prompt(event.systemPrompt, {
				active_team_id: active_team_id,
				ownMember: own_member,
				ownRole: own_role,
			}),
		};
	});

	pi.registerCommand('team', {
		description:
			'Local teammate coordination with tasks, mailboxes, and RPC sessions',
		getArgumentCompletions: (prefix) => {
			const subs = [
				'create',
				'id',
				'status',
				'dashboard',
				'results',
				'resume',
				'teams',
				'switch',
				'ui auto',
				'ui compact',
				'ui full',
				'ui off',
				'ui style plain',
				'ui style badge',
				'ui style color',
				'clear',
				'member add',
				'task add',
				'task list',
				'task show',
				'task done',
				'task block',
				'task cancel',
				'task reopen',
				'task assign',
				'task unassign',
				'task claim',
				'dm',
				'inbox',
				...(own_role === 'teammate'
					? []
					: ['spawn', 'spawn alice --worktree --mutating']),
				'send',
				'steer',
				'wait',
				'shutdown',
			];
			if (should_enable_fake_teammate_command()) subs.push('fake');
			return subs
				.filter((sub) => sub.startsWith(prefix.trim()))
				.map((sub) => ({ value: sub, label: sub }));
		},
		handler: async (args, ctx) =>
			handle_team_command(
				args,
				ctx,
				store,
				runners,
				() => active_team_id,
				(team_id) => {
					active_team_id = team_id;
					reset_completed_task_observer(team_id);
				},
				own_role,
			),
	});

	pi.registerTool({
		name: 'team',
		label: 'Team',
		description:
			'Manage teammate coordination: teams, RPC teammates, tasks, and mailboxes. Real spawning is available through member_spawn.',
		promptSnippet:
			'Manage team-mode members, tasks, messages, and RPC teammate sessions',
		promptGuidelines: [
			'Use team to create and update teammate-mode tasks instead of ad-hoc markdown todo lists when the user asks to coordinate a team.',
			'Only team leads may use member_spawn. Teammate sessions must not spawn nested teammates.',
			'Use team member_spawn to start real RPC teammates, then assign tasks and inspect status with team_status.',
			'Use team_status as the source of truth for member state, task progress, and blocked work.',
		],
		parameters: TeamToolParams,
		async execute(
			_toolCallId,
			params: TeamToolParams,
			_signal,
			_onUpdate,
			ctx,
		) {
			const team_id = params.team_id ?? active_team_id;
			const require_team_id = () => {
				if (!team_id)
					throw new Error(
						'No active team. Use action team_create first.',
					);
				return team_id;
			};

			switch (params.action) {
				case 'team_create': {
					const team = store.create_team({
						cwd: ctx.cwd,
						name: params.name,
					});
					active_team_id = team.id;
					reset_completed_task_observer(team.id);
					set_team_ui(ctx, store, team.id, runners);
					return {
						content: [
							{
								type: 'text' as const,
								text: `Created team ${team.name} (${team.id})`,
							},
						],
						details: { team },
					};
				}
				case 'team_list': {
					const statuses = get_team_statuses(store, runners);
					return {
						content: [
							{
								type: 'text' as const,
								text: format_teams_list(statuses, active_team_id),
							},
						],
						details: {
							active_team_id: active_team_id ?? null,
							teams: statuses,
						},
					};
				}
				case 'team_status': {
					if (!team_id) {
						const latest = get_latest_team_for_cwd(store, ctx.cwd);
						if (!latest) {
							return {
								content: [
									{
										type: 'text' as const,
										text: 'No active team. Use action team_create first.',
									},
								],
								details: { active_team_id: null, latest_team: null },
							};
						}
						const status = get_team_status(store, latest.id, runners);
						return {
							content: [
								{
									type: 'text' as const,
									text: format_status(status),
								},
							],
							details: { ...status, active_team_id: null },
						};
					}
					const status = get_team_status(store, team_id, runners);
					set_team_ui(ctx, store, status.team.id, runners);
					return {
						content: [
							{ type: 'text' as const, text: format_status(status) },
						],
						details: status,
					};
				}
				case 'team_clear': {
					active_team_id = undefined;
					reset_completed_task_observer(undefined);
					set_team_ui(ctx, store, undefined, runners);
					return {
						content: [
							{
								type: 'text' as const,
								text: 'Cleared active team UI',
							},
						],
						details: { active_team_id: null },
					};
				}
				case 'team_ui': {
					const mode = params.mode ?? get_team_ui_mode();
					const style = params.style ?? get_team_ui_style();
					process.env[TEAM_UI_ENV] = mode;
					process.env[TEAM_UI_STYLE_ENV] = style;
					set_team_ui(ctx, store, active_team_id, runners);
					return {
						content: [
							{
								type: 'text' as const,
								text: `Team UI mode: ${mode}, style: ${style}`,
							},
						],
						details: { mode, style },
					};
				}
				case 'member_upsert': {
					const member = store.upsert_member(require_team_id(), {
						name: require_arg(params.member ?? params.name, 'member'),
						role: params.role,
						status: params.status,
					});
					set_team_ui(ctx, store, team_id, runners);
					return {
						content: [
							{
								type: 'text' as const,
								text: `Member ${member.name} saved`,
							},
						],
						details: { member },
					};
				}
				case 'member_spawn': {
					require_lead_for_teammate_spawn(own_role);
					const member_name = require_arg(
						params.member ?? params.name,
						'member',
					);
					const profile = teammate_profile(
						ctx.cwd,
						params.profile ?? params.agent,
					);
					const id = require_team_id();
					const existing = runners.get(member_name);
					if (existing?.is_running) {
						throw new Error(
							`Teammate ${member_name} is already running. Shut it down before spawning another session with the same name.`,
						);
					}
					const workspace = prepare_teammate_workspace({
						team_id: id,
						member: member_name,
						repo_cwd: ctx.cwd,
						team_root: get_team_root(),
						mode: params.workspace_mode,
						branch: params.branch,
						worktree_path: params.worktree_path,
					});
					if (
						params.mutating &&
						workspace.workspace_mode === 'shared'
					) {
						require_no_shared_mutating_conflict(
							store,
							id,
							workspace.cwd,
							member_name,
							params.force,
							attached_member_names(runners),
						);
					}
					const runner = new RpcTeammate(store, {
						team_id: id,
						member: member_name,
						cwd: workspace.cwd,
						team_root: get_team_root(),
						extension_path: get_extension_path(),
						model:
							params.model ??
							profile?.model ??
							(ctx.model
								? `${ctx.model.provider}/${ctx.model.id}`
								: undefined),
						thinking: params.thinking ?? profile?.thinking,
						system_prompt: profile?.system_prompt,
						tools: profile?.tools,
						skills: profile?.skills,
						profile: profile?.name,
						workspace_mode: workspace.workspace_mode,
						worktree_path: workspace.worktree_path,
						branch: workspace.branch,
						mutating: params.mutating ?? false,
						on_exit: (member) => runners.delete(member),
					});
					runners.set(member_name, runner);
					try {
						await runner.start();
					} catch (error) {
						runners.delete(member_name);
						throw error;
					}
					const initial_prompt = profile_prompt(
						profile,
						params.initial_prompt,
					);
					if (initial_prompt) await runner.prompt(initial_prompt);
					set_team_ui(ctx, store, team_id, runners);
					return {
						content: [
							{
								type: 'text' as const,
								text: `Spawned teammate ${member_name}`,
							},
						],
						details: {
							member: store
								.list_members(require_team_id())
								.find((item) => item.name === member_name),
						},
					};
				}
				case 'member_prompt':
				case 'member_follow_up':
				case 'member_steer': {
					const member_name = require_arg(
						params.member ?? params.name,
						'member',
					);
					const runner = runners.get(member_name);
					if (!runner?.is_running)
						throw new Error(`No running teammate: ${member_name}`);
					const text = require_arg(
						params.message ?? params.initial_prompt,
						'message',
					);
					if (params.action === 'member_steer')
						await runner.steer(text);
					else if (params.action === 'member_follow_up')
						await runner.follow_up(text);
					else await runner.prompt(text);
					return {
						content: [
							{
								type: 'text' as const,
								text: `Sent ${params.action} to ${member_name}`,
							},
						],
						details: { member: member_name },
					};
				}
				case 'member_shutdown': {
					const member_name = require_arg(
						params.member ?? params.name,
						'member',
					);
					const runner = runners.get(member_name);
					let member: TeamMember;
					let text: string;
					if (runner?.is_running) {
						await runner.shutdown(params.message);
						runners.delete(member_name);
						member = store.upsert_member(require_team_id(), {
							name: member_name,
							status: 'offline',
						});
						text = `Shutdown requested for ${member_name}`;
					} else {
						member = await shutdown_orphaned_member(
							store,
							require_team_id(),
							member_name,
							params.timeout_ms ?? 3_000,
						);
						text = `Terminated orphaned teammate ${member_name}`;
					}
					set_team_ui(ctx, store, team_id, runners);
					return {
						content: [
							{
								type: 'text' as const,
								text,
							},
						],
						details: { member },
					};
				}
				case 'member_status': {
					const status = get_team_status(
						store,
						require_team_id(),
						runners,
					);
					return {
						content: [
							{ type: 'text' as const, text: format_status(status) },
						],
						details: {
							...status,
							running_members: [...runners.entries()]
								.filter(([, runner]) => runner.is_running)
								.map(([name, runner]) => ({ name, pid: runner.pid })),
						},
					};
				}
				case 'member_wait': {
					const member_name = require_arg(
						params.member ?? params.name,
						'member',
					);
					const runner = runners.get(member_name);
					if (runner?.is_running) {
						await runner.wait_for_idle(params.timeout_ms ?? 120_000);
					} else {
						await wait_for_orphaned_member(
							store,
							require_team_id(),
							member_name,
							params.timeout_ms ?? 120_000,
						);
					}
					const status = get_team_status(
						store,
						require_team_id(),
						runners,
					);
					set_team_ui(ctx, store, team_id, runners);
					return {
						content: [
							{ type: 'text' as const, text: format_status(status) },
						],
						details: status,
					};
				}
				case 'task_create': {
					const task = store.create_task(require_team_id(), {
						title: require_arg(params.title, 'title'),
						description: params.description,
						assignee: params.assignee,
						depends_on: params.depends_on,
					});
					set_team_ui(ctx, store, team_id, runners);
					return {
						content: [
							{
								type: 'text' as const,
								text: `Created task #${task.id}: ${task.title}`,
							},
						],
						details: { task },
					};
				}
				case 'task_list': {
					const tasks = store.list_tasks(require_team_id());
					return {
						content: [
							{
								type: 'text' as const,
								text: format_status(
									get_team_status(store, require_team_id(), runners),
								),
							},
						],
						details: { tasks },
					};
				}
				case 'task_get': {
					const task = store.load_task(
						require_team_id(),
						require_arg(params.task_id, 'task_id'),
					);
					return {
						content: [
							{
								type: 'text' as const,
								text: format_task_detail(task),
							},
						],
						details: { task },
					};
				}
				case 'task_update': {
					const task = store.update_task(
						require_team_id(),
						require_arg(params.task_id, 'task_id'),
						{
							title: params.title,
							description: params.description,
							status: params.task_status,
							assignee: params.clear_assignee
								? null
								: params.assignee,
							depends_on: params.depends_on,
							result: params.clear_result ? null : params.result,
						},
					);
					set_team_ui(ctx, store, team_id, runners);
					return {
						content: [
							{
								type: 'text' as const,
								text: `Updated task #${task.id}`,
							},
						],
						details: { task },
					};
				}
				case 'task_claim_next': {
					const task = store.claim_next_task(
						require_team_id(),
						require_arg(params.assignee ?? params.member, 'assignee'),
					);
					set_team_ui(ctx, store, team_id, runners);
					return {
						content: [
							{
								type: 'text' as const,
								text: task
									? `Claimed task #${task.id}: ${task.title}`
									: 'No ready pending tasks',
							},
						],
						details: { task },
					};
				}
				case 'message_send': {
					const active = require_team_id();
					const message = store.send_message(active, {
						from: params.from ?? own_member,
						to: require_arg(params.to, 'to'),
						body: require_arg(params.message, 'message'),
						urgent: params.urgent,
					});
					const runner = runners.get(message.to);
					if (runner?.is_running) {
						await deliver_message_to_runner(
							store,
							active,
							runner,
							message,
						);
					}
					return {
						content: [
							{
								type: 'text' as const,
								text: `Sent message ${message.id} to ${message.to}`,
							},
						],
						details: { message },
					};
				}
				case 'message_list': {
					const messages = store.list_messages(
						require_team_id(),
						require_arg(params.member ?? params.to, 'member'),
					);
					return {
						content: [
							{
								type: 'text' as const,
								text: format_messages(messages),
							},
						],
						details: { messages },
					};
				}
				case 'message_read':
				case 'message_ack': {
					const messages = store.acknowledge_messages(
						require_team_id(),
						require_arg(params.member ?? params.to, 'member'),
					);
					return {
						content: [
							{
								type: 'text' as const,
								text: format_messages(messages),
							},
						],
						details: { messages },
					};
				}
			}
		},
	});
}
