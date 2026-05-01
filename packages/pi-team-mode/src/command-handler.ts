import {
	getAgentDir,
	type BeforeAgentStartEvent,
	type ExtensionCommandContext,
	type ExtensionContext,
} from '@mariozechner/pi-coding-agent';
import {
	Key,
	matchesKey,
	truncateToWidth,
	type SelectItem,
	type SettingItem,
} from '@mariozechner/pi-tui';
import {
	show_confirm_modal,
	show_input_modal,
	show_modal,
	show_picker_modal,
	show_settings_modal,
} from '@spences10/pi-tui-modal';
import {
	parse_spawn_request,
	parse_task_add,
	profile_prompt,
} from './command-parser.js';
import {
	get_extension_path,
	get_team_root,
	should_enable_fake_teammate_command,
} from './config.js';
import { fake_teammate_step } from './fake-runner.js';
import {
	collect_session_usage,
	collect_team_mailboxes,
	format_completed_task_results,
	format_member_status,
	format_messages,
	format_status,
	format_status_counts,
	format_task_detail,
	format_task_status,
	format_team_dashboard,
	format_teams_list,
	summarize_result,
} from './formatting.js';
import {
	resolve_teammate_profile,
	type TeammateProfile,
} from './profiles.js';
import { RpcTeammate } from './rpc-runner.js';
import {
	attached_member_names,
	deliver_message_to_runner,
	get_team_status,
	get_team_statuses,
	shutdown_orphaned_member,
	wait_for_orphaned_member,
} from './runner-orchestration.js';
import {
	TeamStore,
	type TeamConfig,
	type TeamStatus,
} from './store.js';
import type { TeamUiMode, TeamUiStyle } from './team-tool-params.js';
import {
	get_team_ui_mode,
	get_team_ui_style,
	has_modal_ui,
	set_team_ui,
	show_team_switcher,
	show_team_text_modal,
	TEAM_UI_ENV,
	TEAM_UI_STYLE_ENV,
} from './ui-status.js';
import {
	require_no_shared_mutating_conflict,
	require_no_worktree_assignment_conflict,
} from './workspace-guards.js';
import { prepare_teammate_workspace } from './workspace.js';

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

export function append_team_system_prompt(
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
- Mailbox states are separate: delivered means queued to a session, read means reviewed, acknowledged means fully processed and safe to suppress redelivery. Teammates should use message_read after reviewing messages and message_ack after acting on them.
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

export function teammate_profile(
	cwd: string,
	name: string | undefined,
): TeammateProfile | undefined {
	return resolve_teammate_profile(
		{ cwd, agent_dir: getAgentDir() },
		name,
	);
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

	const current_status = team_id
		? await store.get_status(team_id)
		: undefined;
	await show_settings_modal(ctx, {
		title: 'Team UI',
		subtitle: () =>
			current_status
				? `Active team ${team_id} • ${format_status_counts(current_status)}`
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
	const statuses = await get_team_statuses(store);
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
				value: 'task add',
				label: 'Create task',
				description: 'Queue work with an optional assignee',
			},
			{
				value: 'member add',
				label: 'Add member',
				description: 'Register a teammate name before assigning work',
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
				value: 'members',
				label: 'Teammate actions',
				description:
					active_status.members.length > 0
						? `${active_status.members.length} members available`
						: 'No members yet',
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
		footer: 'enter manages task • esc back',
	});
}

type TeamTaskModalAction =
	| 'show'
	| 'done'
	| 'block'
	| 'cancel'
	| 'reopen'
	| 'assign'
	| 'unassign';

async function show_team_task_action_modal(
	ctx: ExtensionCommandContext,
	status: TeamStatus,
	task: TeamStatus['tasks'][number],
): Promise<TeamTaskModalAction | undefined> {
	const items: SelectItem[] = [
		{
			value: 'show',
			label: 'Show details',
			description: 'Read the task description and result note',
		},
	];

	if (task.status !== 'completed') {
		items.push({
			value: 'done',
			label: 'Mark completed',
			description: 'Optionally add a result note',
		});
	}
	if (task.status !== 'blocked') {
		items.push({
			value: 'block',
			label: 'Mark blocked',
			description: 'Add a blocker note',
		});
	}
	if (task.status !== 'cancelled') {
		items.push({
			value: 'cancel',
			label: 'Cancel task',
			description: 'Optionally add a cancellation reason',
		});
	}
	if (task.status !== 'pending') {
		items.push({
			value: 'reopen',
			label: 'Reopen task',
			description: 'Move back to pending and clear the result note',
		});
	}
	if (status.members.length > 0) {
		items.push({
			value: 'assign',
			label: 'Assign member',
			description: 'Choose a teammate for this task',
		});
	}
	if (task.assignee) {
		items.push({
			value: 'unassign',
			label: 'Unassign',
			description: `Remove ${task.assignee} from this task`,
		});
	}

	const selected = await show_picker_modal(ctx, {
		title: `Task #${task.id}`,
		subtitle: `${task.status} • ${task.assignee ? `@${task.assignee}` : 'unassigned'}`,
		items,
		footer: 'enter runs action • esc back',
	});
	return selected as TeamTaskModalAction | undefined;
}

async function show_team_member_picker(
	ctx: ExtensionCommandContext,
	status: TeamStatus,
	options: { title: string; subtitle?: string },
): Promise<string | undefined> {
	return await show_picker_modal(ctx, {
		title: options.title,
		subtitle: options.subtitle,
		items: status.members.map((member) => ({
			value: member.name,
			label: member.name,
			description: `${member.role} • ${format_member_status(member)}`,
		})),
		empty_message: 'No members yet. Add one first.',
	});
}

async function prompt_team_name(
	ctx: ExtensionCommandContext,
): Promise<string | undefined> {
	return await show_input_modal(ctx, {
		title: 'Create team',
		label: 'Team name (optional)',
		allow_empty: true,
	});
}

async function prompt_member_name(
	ctx: ExtensionCommandContext,
): Promise<string | undefined> {
	return await show_input_modal(ctx, {
		title: 'Add member',
		label: 'Member name',
	});
}

async function prompt_task_note(
	ctx: ExtensionCommandContext,
	options: { title: string; label: string },
): Promise<string | undefined> {
	return await show_input_modal(ctx, {
		title: options.title,
		label: options.label,
		allow_empty: true,
	});
}

async function prompt_task_create(
	ctx: ExtensionCommandContext,
	status: TeamStatus,
): Promise<{ title: string; assignee?: string } | undefined> {
	const title = await show_input_modal(ctx, {
		title: 'Create task',
		label: 'Task title',
	});
	if (!title) return undefined;
	if (status.members.length === 0) return { title };

	const assignee = await show_picker_modal(ctx, {
		title: 'Assign task',
		subtitle: title,
		items: [
			{
				value: '__unassigned__',
				label: 'Leave unassigned',
				description: 'Queue the task without an owner',
			},
			...status.members.map((member) => ({
				value: member.name,
				label: member.name,
				description: `${member.role} • ${format_member_status(member)}`,
			})),
		],
		footer: 'enter selects • esc leaves unassigned',
	});
	return {
		title,
		assignee:
			assignee && assignee !== '__unassigned__'
				? assignee
				: undefined,
	};
}

type TeamMemberModalAction =
	| 'dm'
	| 'send'
	| 'steer'
	| 'wait'
	| 'shutdown';

async function show_team_member_action_modal(
	ctx: ExtensionCommandContext,
	member: TeamStatus['members'][number],
	runner: RpcTeammate | undefined,
): Promise<TeamMemberModalAction | undefined> {
	const is_running = runner?.is_running;
	const is_orphaned = member.status === 'running_orphaned';
	const items: SelectItem[] = [
		{
			value: 'dm',
			label: 'Send mailbox DM',
			description: 'Leave a persistent team message',
		},
	];
	if (is_running) {
		items.push(
			{
				value: 'send',
				label: 'Send prompt',
				description: 'Send a normal prompt to the running teammate',
			},
			{
				value: 'steer',
				label: 'Steer current turn',
				description: 'Queue guidance for the current teammate turn',
			},
		);
	}
	if (is_running || is_orphaned) {
		items.push(
			{
				value: 'wait',
				label: 'Wait for idle/offline',
				description: 'Block until the teammate stops running',
			},
			{
				value: 'shutdown',
				label: 'Shutdown teammate',
				description:
					'Ask attached runner to stop or terminate safe orphan',
			},
		);
	}

	const selected = await show_picker_modal(ctx, {
		title: member.name,
		subtitle: `${member.role} • ${format_member_status(member)}`,
		items,
		footer: 'enter runs action • esc back',
	});
	return selected as TeamMemberModalAction | undefined;
}

async function show_team_member_actions_modal(
	ctx: ExtensionCommandContext,
	store: TeamStore,
	team_id: string,
	runners: Map<string, RpcTeammate>,
): Promise<void> {
	while (true) {
		const status = await get_team_status(store, team_id, runners);
		const member_name = await show_team_member_picker(ctx, status, {
			title: 'Teammate actions',
			subtitle: `${status.team.name} • ${status.members.length} member(s)`,
		});
		if (!member_name) return;
		const member = status.members.find(
			(item) => item.name === member_name,
		);
		if (!member) continue;
		const action = await show_team_member_action_modal(
			ctx,
			member,
			runners.get(member.name),
		);
		if (!action) continue;
		await run_member_modal_action(
			ctx,
			store,
			team_id,
			runners,
			member.name,
			action,
		);
	}
}

async function run_member_modal_action(
	ctx: ExtensionCommandContext,
	store: TeamStore,
	team_id: string,
	runners: Map<string, RpcTeammate>,
	member_name: string,
	action: TeamMemberModalAction,
): Promise<void> {
	if (action === 'dm') {
		const body = await show_input_modal(ctx, {
			title: `DM ${member_name}`,
			label: 'Message',
		});
		if (!body) return;
		const message = await store.send_message(team_id, {
			from: 'lead',
			to: member_name,
			body,
		});
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
		return;
	}

	if (action === 'send' || action === 'steer') {
		const prompt = await show_input_modal(ctx, {
			title:
				action === 'send'
					? `Send prompt to ${member_name}`
					: `Steer ${member_name}`,
			label: action === 'send' ? 'Prompt' : 'Steering message',
		});
		if (!prompt) return;
		const runner = runners.get(member_name);
		if (!runner?.is_running)
			throw new Error(`No running teammate: ${member_name}`);
		if (action === 'send') await runner.prompt(prompt);
		else await runner.steer(prompt);
		ctx.ui.notify(
			action === 'send'
				? `Sent prompt to ${member_name}`
				: `Steered ${member_name}`,
		);
		return;
	}

	if (action === 'wait') {
		const runner = runners.get(member_name);
		if (runner?.is_running) await runner.wait_for_idle();
		else
			await wait_for_orphaned_member(
				store,
				team_id,
				member_name,
				120_000,
			);
		ctx.ui.notify(`${member_name} is no longer running`);
		return;
	}

	const confirmed = await show_confirm_modal(ctx, {
		title: `Shutdown ${member_name}?`,
		message:
			'Attached runners are asked to stop; safe orphaned teammate processes are terminated.',
		confirm_label: 'Shutdown',
	});
	if (!confirmed) return;
	const runner = runners.get(member_name);
	if (runner?.is_running) {
		await runner.shutdown('leader requested shutdown');
		runners.delete(member_name);
		await store.upsert_member(team_id, {
			name: member_name,
			status: 'offline',
		});
		ctx.ui.notify(`Shutdown requested for ${member_name}`);
	} else {
		const member = await shutdown_orphaned_member(
			store,
			team_id,
			member_name,
		);
		ctx.ui.notify(
			`Terminated orphaned teammate ${member_name}; status ${member.status}`,
		);
	}
}

async function run_task_modal_action(
	ctx: ExtensionCommandContext,
	store: TeamStore,
	team_id: string,
	status: TeamStatus,
	task_id: string,
	action: TeamTaskModalAction,
): Promise<void> {
	const task = store.load_task(team_id, task_id);
	if (action === 'show') {
		await show_team_text_modal(ctx, {
			title: `Task #${task_id}`,
			subtitle: status.team.name,
			text: format_task_detail(task),
		});
		return;
	}

	if (action === 'assign') {
		const assignee = await show_team_member_picker(ctx, status, {
			title: `Assign task #${task_id}`,
			subtitle: task.title,
		});
		if (!assignee) return;
		await store.update_task(team_id, task_id, { assignee });
		ctx.ui.notify(`Assigned task #${task_id} to ${assignee}`);
		return;
	}

	if (action === 'unassign') {
		const confirmed = await show_confirm_modal(ctx, {
			title: `Unassign task #${task_id}?`,
			message: task.assignee
				? `Remove ${task.assignee} from ${task.title}?`
				: `Task #${task_id} is already unassigned.`,
			confirm_label: 'Unassign',
		});
		if (!confirmed) return;
		await store.update_task(team_id, task_id, { assignee: null });
		ctx.ui.notify(`Unassigned task #${task_id}`);
		return;
	}

	if (action === 'reopen') {
		const confirmed = await show_confirm_modal(ctx, {
			title: `Reopen task #${task_id}?`,
			message: `Move ${task.title} back to pending and clear the result note?`,
			confirm_label: 'Reopen',
		});
		if (!confirmed) return;
		await store.update_task(team_id, task_id, {
			status: 'pending',
			result: null,
		});
		ctx.ui.notify(`Reopened task #${task_id}`);
		return;
	}

	const note = await prompt_task_note(ctx, {
		title:
			action === 'done'
				? `Complete task #${task_id}`
				: action === 'block'
					? `Block task #${task_id}`
					: `Cancel task #${task_id}`,
		label:
			action === 'done'
				? 'Result note (optional)'
				: action === 'block'
					? 'Blocker reason (optional)'
					: 'Cancellation reason (optional)',
	});
	if (note === undefined) return;
	const next_status =
		action === 'done'
			? 'completed'
			: action === 'block'
				? 'blocked'
				: 'cancelled';
	await store.update_task(team_id, task_id, {
		status: next_status,
		result: note || null,
	});
	ctx.ui.notify(`Updated task #${task_id} to ${next_status}`);
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
	if (
		has_modal_ui(ctx) &&
		typeof ctx.ui.setEditorText === 'function'
	) {
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
	if (!trimmed && has_modal_ui(ctx)) {
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
				let name = rest_text;
				if (!name && has_modal_ui(ctx)) {
					const input = await prompt_team_name(ctx);
					if (input === undefined) break;
					name = input;
				}
				const team = store.create_team({
					cwd: ctx.cwd,
					name: name || undefined,
				});
				set_active_team_id(team.id);
				set_team_ui(ctx, store, team.id, runners);
				ctx.ui.notify(`Created team ${team.name} (${team.id})`);
				break;
			}
			case 'id': {
				const team_id = current_team_id();
				const text = `${team_id}\n${store.team_dir(team_id)}`;
				if (has_modal_ui(ctx)) {
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
					if (has_modal_ui(ctx)) {
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
				if (has_modal_ui(ctx)) {
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
					const statuses = await get_team_statuses(store, runners);
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
				const status = await get_team_status(store, team_id, runners);
				set_team_ui(ctx, store, team_id, runners);
				const text = format_status(status);
				if (has_modal_ui(ctx)) {
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
				const status = await get_team_status(store, team_id, runners);
				set_team_ui(ctx, store, team_id, runners);
				if (has_modal_ui(ctx)) {
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
					await get_team_status(store, team_id, runners),
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
			case 'members': {
				const team_id = current_team_id();
				await show_team_member_actions_modal(
					ctx,
					store,
					team_id,
					runners,
				);
				set_team_ui(ctx, store, team_id, runners);
				break;
			}
			case 'member': {
				const [action, name] = rest;
				if (action !== 'add')
					throw new Error('Usage: /team member add <name>');
				let member_name: string | undefined = name;
				if (!member_name && has_modal_ui(ctx)) {
					member_name = await prompt_member_name(ctx);
					if (!member_name) break;
				}
				const member = await store.upsert_member(current_team_id(), {
					name: require_arg(member_name, 'member name'),
				});
				set_team_ui(ctx, store, get_active_team_id(), runners);
				ctx.ui.notify(`Member ${member.name} ready`);
				break;
			}
			case 'task': {
				const [action, id, ...tail] = rest;
				const team_id = current_team_id();
				if (action === 'add') {
					const text = rest.slice(1).join(' ');
					const parsed = text
						? parse_task_add(text)
						: has_modal_ui(ctx)
							? await prompt_task_create(
									ctx,
									await get_team_status(store, team_id, runners),
								)
							: parse_task_add(text);
					if (!parsed) break;
					const task = await store.create_task(team_id, parsed);
					set_team_ui(ctx, store, team_id, runners);
					ctx.ui.notify(`Created task #${task.id}: ${task.title}`);
				} else if (action === 'list' || !action) {
					let status = await get_team_status(store, team_id, runners);
					if (has_modal_ui(ctx) && status.tasks.length > 0) {
						while (true) {
							const task_id = await show_team_task_picker(
								ctx,
								status,
							);
							if (!task_id) break;
							const action = await show_team_task_action_modal(
								ctx,
								status,
								store.load_task(team_id, task_id),
							);
							if (action) {
								await run_task_modal_action(
									ctx,
									store,
									team_id,
									status,
									task_id,
									action,
								);
								set_team_ui(ctx, store, team_id, runners);
							}
							status = await get_team_status(store, team_id, runners);
						}
					} else if (has_modal_ui(ctx)) {
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
					if (has_modal_ui(ctx)) {
						await show_team_text_modal(ctx, {
							title: `Task #${task_id}`,
							text,
						});
					} else {
						ctx.ui.notify(text);
					}
				} else if (action === 'done') {
					const task = await store.update_task(
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
					const task = await store.update_task(
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
					const task = await store.update_task(
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
					const task = await store.update_task(
						team_id,
						require_arg(id, 'task id'),
						{ status: 'pending', result: null },
					);
					set_team_ui(ctx, store, team_id, runners);
					ctx.ui.notify(`Reopened task #${task.id}`);
				} else if (action === 'assign') {
					const task = await store.update_task(
						team_id,
						require_arg(id, 'task id'),
						{ assignee: require_arg(tail[0], 'assignee') },
					);
					set_team_ui(ctx, store, team_id, runners);
					ctx.ui.notify(
						`Assigned task #${task.id} to ${task.assignee}`,
					);
				} else if (action === 'unassign') {
					const task = await store.update_task(
						team_id,
						require_arg(id, 'task id'),
						{ assignee: null },
					);
					set_team_ui(ctx, store, team_id, runners);
					ctx.ui.notify(`Unassigned task #${task.id}`);
				} else if (action === 'claim') {
					const assignee = require_arg(id, 'assignee');
					const task = await store.claim_next_task(team_id, assignee);
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
				const message = await store.send_message(current_team_id(), {
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
				const [member_arg, action_arg, ...ids] = rest;
				const member = member_arg || 'lead';
				let text: string;
				if (action_arg === 'read' || action_arg === 'ack') {
					const messages =
						action_arg === 'read'
							? await store.mark_messages_read(
									current_team_id(),
									member,
									ids.length ? ids : undefined,
								)
							: await store.acknowledge_messages(
									current_team_id(),
									member,
									ids.length ? ids : undefined,
								);
					text = format_messages(messages);
				} else {
					text = format_messages(
						store.list_messages(current_team_id(), member),
					);
				}
				if (has_modal_ui(ctx)) {
					await show_team_text_modal(ctx, {
						title: `${member} inbox`,
						text,
					});
				} else {
					ctx.ui.notify(text);
				}
				break;
			}
			case 'read':
			case 'ack': {
				const [member, ...ids] = rest;
				const messages =
					sub === 'read'
						? await store.mark_messages_read(
								current_team_id(),
								require_arg(member, 'member'),
								ids.length ? ids : undefined,
							)
						: await store.acknowledge_messages(
								current_team_id(),
								require_arg(member, 'member'),
								ids.length ? ids : undefined,
							);
				ctx.ui.notify(format_messages(messages));
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
				await require_no_worktree_assignment_conflict(
					store,
					team_id,
					workspace,
					name,
					request.force,
					attached_member_names(runners),
				);
				if (
					request.mutating &&
					workspace.workspace_mode === 'shared'
				) {
					await require_no_shared_mutating_conflict(
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
					await store.upsert_member(current_team_id(), {
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
				const status = await get_team_status(
					store,
					current_team_id(),
					runners,
				);
				const text = format_status(status);
				if (has_modal_ui(ctx)) {
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
				const result = await fake_teammate_step(
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
						'/team inbox <member> read|ack [message-id...] — mark mailbox messages read or acknowledged',
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
