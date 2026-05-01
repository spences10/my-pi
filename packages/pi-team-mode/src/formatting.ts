import { existsSync, readFileSync } from 'node:fs';
import {
	TeamStore,
	type TeamMember,
	type TeamMessage,
	type TeamStatus,
	type TeamTaskStatus,
} from './store.js';

export function format_task_status(status: TeamTaskStatus): string {
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

export function summarize_result(
	result: string | undefined,
): string | undefined {
	const summary = result?.trim().split(/\r?\n/, 1)[0]?.trim();
	if (!summary) return undefined;
	return summary.length > 140
		? `${summary.slice(0, 137)}...`
		: summary;
}

export function count_label(
	count: number,
	singular: string,
	plural = `${singular}s`,
): string {
	return `${count} ${count === 1 ? singular : plural}`;
}

export function format_status_counts(status: TeamStatus): string {
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

export function format_member_status(
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

export function format_task_line(
	task: TeamStatus['tasks'][number],
): string {
	const owner = task.assignee ? ` @${task.assignee}` : '';
	const deps = task.depends_on.length
		? ` waits for #${task.depends_on.join(', #')}`
		: '';
	return `${format_task_status(task.status)} #${task.id}${owner}${deps} ${task.title}`;
}

export function format_task_detail(
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

export function format_status(status: TeamStatus): string {
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

export function format_teams_list(
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

export function format_messages(messages: TeamMessage[]): string {
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

export interface SessionUsageSummary {
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

export function collect_team_mailboxes(
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

export function collect_session_usage(
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

export function format_injected_messages(
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

export function format_rpc_message(message: TeamMessage): string {
	return `<teammate-message id="${message.id}" from="${message.from}" urgent="${message.urgent}">\n${message.body}\n</teammate-message>\nAfter handling this message, acknowledge it with team action message_read for your member.`;
}
