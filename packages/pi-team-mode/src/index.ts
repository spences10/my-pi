import { StringEnum } from '@mariozechner/pi-ai';
import {
	getAgentDir,
	type BeforeAgentStartEvent,
	type ExtensionAPI,
	type ExtensionCommandContext,
	type ExtensionContext,
} from '@mariozechner/pi-coding-agent';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Type, type Static } from 'typebox';
import { fake_teammate_step } from './fake-runner.js';
import { RpcTeammate } from './rpc-runner.js';
import {
	TeamStore,
	type TeamConfig,
	type TeamMessage,
	type TeamStatus,
	type TeamTaskStatus,
} from './store.js';

const TEAM_ROOT_ENV = 'MY_PI_TEAM_MODE_ROOT';
const ACTIVE_TEAM_ENV = 'MY_PI_ACTIVE_TEAM_ID';
const TEAM_MEMBER_ENV = 'MY_PI_TEAM_MEMBER';
const TEAM_ROLE_ENV = 'MY_PI_TEAM_ROLE';
const EXTENSION_PATH_ENV = 'MY_PI_TEAM_EXTENSION_PATH';
const AUTO_INJECT_ENV = 'MY_PI_TEAM_AUTO_INJECT_MESSAGES';
const TEAM_UI_ENV = 'MY_PI_TEAM_UI';
const STATUS_KEY = 'team';

type TeamUiMode = 'auto' | 'compact' | 'full' | 'off';

const TeamAction = StringEnum([
	'team_create',
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
	'task_update',
	'task_claim_next',
	'message_send',
	'message_list',
	'message_read',
	'fake_teammate_step',
] as const);

const TeamToolParams = Type.Object({
	action: TeamAction,
	teamId: Type.Optional(Type.String()),
	name: Type.Optional(Type.String()),
	member: Type.Optional(Type.String()),
	role: Type.Optional(StringEnum(['lead', 'teammate'] as const)),
	status: Type.Optional(
		StringEnum(['idle', 'running', 'blocked', 'offline'] as const),
	),
	title: Type.Optional(Type.String()),
	description: Type.Optional(Type.String()),
	taskId: Type.Optional(Type.String()),
	taskStatus: Type.Optional(
		StringEnum([
			'pending',
			'in_progress',
			'blocked',
			'completed',
			'cancelled',
		] as const),
	),
	assignee: Type.Optional(Type.String()),
	dependsOn: Type.Optional(Type.Array(Type.String())),
	result: Type.Optional(Type.String()),
	from: Type.Optional(Type.String()),
	to: Type.Optional(Type.String()),
	message: Type.Optional(Type.String()),
	urgent: Type.Optional(Type.Boolean()),
	initialPrompt: Type.Optional(Type.String()),
	model: Type.Optional(Type.String()),
	thinking: Type.Optional(Type.String()),
	timeoutMs: Type.Optional(Type.Number()),
	complete: Type.Optional(Type.Boolean()),
	shutdownOnMessage: Type.Optional(Type.Boolean()),
	mode: Type.Optional(
		StringEnum(['auto', 'compact', 'full', 'off'] as const),
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

function append_team_system_prompt(
	base_prompt: string,
	options: {
		activeTeamId?: string;
		ownMember: string;
		ownRole: string;
	},
): string {
	const role_text =
		options.ownRole === 'teammate' ? 'teammate' : 'team lead';
	const active_context = options.activeTeamId
		? `You are ${role_text} \`${options.ownMember}\` in team \`${options.activeTeamId}\`.`
		: 'No team is active yet. Create one with the `team` tool when the user asks for parallel/background teammate work.';

	return (
		base_prompt +
		`

## Experimental Team Mode

${active_context}
Use the \`team\` tool as the source of truth for team coordination.

Rules:
- The team lead should create tasks, spawn members, message teammates, and inspect status through the \`team\` tool.
- Teammates should read messages, claim exactly one ready task, work it, update the task with status/result, then go idle.
- Do not create nested teams from a teammate session.
- Use urgent steer/follow-up messaging for coordination instead of assuming shared context.
- Use real RPC teammates via member_spawn for background work; use fake_teammate_step only for local tests/evals.
- Prefer separate git worktrees or read-only/research tasks for teammates that may touch files.`
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

function format_status(status: TeamStatus): string {
	const lines = [
		`Team ${status.team.name} (${status.team.id})`,
		`${status.members.length} member(s), ${status.tasks.length} task(s): ${status.counts.pending} pending, ${status.counts.in_progress} running, ${status.counts.blocked} blocked, ${status.counts.completed} done`,
	];
	if (status.members.length > 0) {
		lines.push('', 'Members:');
		for (const member of status.members) {
			lines.push(
				`- ${member.name} (${member.role}) ${member.status}`,
			);
		}
	}
	if (status.tasks.length > 0) {
		lines.push('', 'Tasks:');
		for (const task of status.tasks) {
			const owner = task.assignee ? ` @${task.assignee}` : '';
			const deps = task.dependsOn.length
				? ` deps:${task.dependsOn.join(',')}`
				: '';
			lines.push(
				`${format_task_status(task.status)} #${task.id}${owner}${deps} ${task.title}`,
			);
			const result = summarize_result(task.result);
			if (result) lines.push(`  ↳ ${result}`);
		}
	}
	return lines.join('\n');
}

function format_messages(messages: TeamMessage[]): string {
	if (messages.length === 0) return 'No messages';
	return messages
		.map((message) => {
			const unread = message.readAt ? '' : ' unread';
			const urgent = message.urgent ? ' urgent' : '';
			return `- ${message.id}${urgent}${unread} from ${message.from}: ${message.body}`;
		})
		.join('\n');
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
	];
	return lines.join('\n');
}

function parse_task_add(text: string): {
	assignee?: string;
	title: string;
} {
	const match = text.match(/^([a-zA-Z0-9_.-]+):\s*(.+)$/);
	if (!match) return { title: text.trim() };
	return { assignee: match[1], title: match[2].trim() };
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

function format_team_footer_status(status: TeamStatus): string {
	const fragments = [`team:${status.team.name}`];
	if (status.counts.in_progress > 0)
		fragments.push(`${status.counts.in_progress} running`);
	if (status.counts.blocked > 0)
		fragments.push(`${status.counts.blocked} blocked`);
	if (status.counts.pending > 0)
		fragments.push(`${status.counts.pending} pending`);
	fragments.push(
		`${status.counts.completed}/${status.tasks.length} done`,
	);
	return fragments.join(' · ');
}

function set_team_ui(
	ctx: ExtensionContext,
	store: TeamStore,
	team_id: string | undefined,
): void {
	if (!ctx.hasUI) return;
	if (!team_id || get_team_ui_mode() === 'off') {
		ctx.ui.setStatus(STATUS_KEY, undefined);
		ctx.ui.setWidget(STATUS_KEY, undefined);
		return;
	}
	try {
		const status = store.get_status(team_id);
		const footer = format_team_footer_status(status);
		ctx.ui.setStatus(STATUS_KEY, themed(ctx, 'dim', footer));

		const mode = get_team_ui_mode();
		const should_show_widget =
			mode === 'full' ||
			(mode === 'auto' &&
				(status.counts.pending > 0 ||
					status.counts.in_progress > 0 ||
					status.counts.blocked > 0));
		if (!should_show_widget) {
			ctx.ui.setWidget(STATUS_KEY, undefined);
			return;
		}

		ctx.ui.setWidget(
			STATUS_KEY,
			[
				themed(
					ctx,
					'dim',
					`Team ${status.team.name}: ${status.members.length} member(s), ${status.tasks.length} task(s)`,
				),
				themed(
					ctx,
					'dim',
					`${status.counts.pending} pending • ${status.counts.in_progress} running • ${status.counts.blocked} blocked • ${status.counts.completed} done`,
				),
			],
			{ placement: 'belowEditor' },
		);
	} catch {
		ctx.ui.setStatus(STATUS_KEY, undefined);
		ctx.ui.setWidget(STATUS_KEY, undefined);
	}
}

async function handle_team_command(
	args: string,
	ctx: ExtensionCommandContext,
	store: TeamStore,
	runners: Map<string, RpcTeammate>,
	get_active_team_id: () => string | undefined,
	set_active_team_id: (team_id: string | undefined) => void,
): Promise<void> {
	const trimmed = args.trim();
	const [sub = 'status', ...rest] = trimmed.split(/\s+/);
	const rest_text = rest.join(' ').trim();

	function current_team_id(): string {
		const team_id = get_active_team_id();
		if (!team_id)
			throw new Error('No active team. Use /team create [name].');
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
				set_team_ui(ctx, store, team.id);
				ctx.ui.notify(`Created team ${team.name} (${team.id})`);
				break;
			}
			case 'id': {
				const team_id = current_team_id();
				ctx.ui.notify(`${team_id}\n${store.team_dir(team_id)}`);
				break;
			}
			case 'ui': {
				const mode = rest_text.trim().toLowerCase();
				if (!mode) {
					ctx.ui.notify(`Team UI mode: ${get_team_ui_mode()}`);
					break;
				}
				if (!['auto', 'compact', 'full', 'off'].includes(mode)) {
					throw new Error('Usage: /team ui auto|compact|full|off');
				}
				process.env[TEAM_UI_ENV] = mode;
				set_team_ui(ctx, store, get_active_team_id());
				ctx.ui.notify(`Team UI mode: ${mode}`);
				break;
			}
			case 'clear':
			case 'close': {
				set_active_team_id(undefined);
				set_team_ui(ctx, store, undefined);
				ctx.ui.notify('Cleared active team UI');
				break;
			}
			case 'status':
			case 'list': {
				const team_id = current_team_id();
				set_team_ui(ctx, store, team_id);
				ctx.ui.notify(format_status(store.get_status(team_id)));
				break;
			}
			case 'resume': {
				const team = get_latest_team_for_cwd(store, ctx.cwd);
				if (!team) throw new Error('No previous team for this cwd.');
				set_active_team_id(team.id);
				set_team_ui(ctx, store, team.id);
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
				set_team_ui(ctx, store, get_active_team_id());
				ctx.ui.notify(`Member ${member.name} ready`);
				break;
			}
			case 'task': {
				const [action, id, ...tail] = rest;
				const team_id = current_team_id();
				if (action === 'add') {
					const parsed = parse_task_add(rest.slice(1).join(' '));
					const task = store.create_task(team_id, parsed);
					set_team_ui(ctx, store, team_id);
					ctx.ui.notify(`Created task #${task.id}: ${task.title}`);
				} else if (action === 'list' || !action) {
					ctx.ui.notify(format_status(store.get_status(team_id)));
				} else if (action === 'done') {
					const task = store.update_task(
						team_id,
						require_arg(id, 'task id'),
						{
							status: 'completed',
							result: tail.join(' ') || undefined,
						},
					);
					set_team_ui(ctx, store, team_id);
					ctx.ui.notify(`Completed task #${task.id}`);
				} else if (action === 'claim') {
					const assignee = require_arg(id, 'assignee');
					const task = store.claim_next_task(team_id, assignee);
					set_team_ui(ctx, store, team_id);
					ctx.ui.notify(
						task
							? `Claimed #${task.id}: ${task.title}`
							: 'No ready pending tasks',
					);
				} else {
					throw new Error(
						'Usage: /team task add|list|done|claim ...',
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
				const runner = runners.get(message.to);
				if (runner?.isRunning) {
					await runner.followUp(message.body);
					store.mark_messages_read(current_team_id(), message.to);
				}
				ctx.ui.notify(`Sent ${message.id} to ${message.to}`);
				break;
			}
			case 'inbox': {
				const member = rest_text || 'lead';
				ctx.ui.notify(
					format_messages(
						store.list_messages(current_team_id(), member),
					),
				);
				break;
			}
			case 'spawn': {
				const [member, ...prompt_parts] = rest;
				const name = require_arg(member, 'member');
				const team_id = current_team_id();
				const current_model = (ctx as ExtensionContext).model;
				const runner = new RpcTeammate(store, {
					teamId: team_id,
					member: name,
					cwd: ctx.cwd,
					teamRoot: get_team_root(),
					extensionPath: get_extension_path(),
					model: current_model
						? `${current_model.provider}/${current_model.id}`
						: undefined,
				});
				runners.set(name, runner);
				await runner.start();
				const prompt = prompt_parts.join(' ').trim();
				if (prompt) await runner.prompt(prompt);
				set_team_ui(ctx, store, team_id);
				ctx.ui.notify(
					`Spawned teammate ${name}${prompt ? ' and sent prompt' : ''}`,
				);
				break;
			}
			case 'send': {
				const [member, ...message_parts] = rest;
				const name = require_arg(member, 'member');
				const runner = runners.get(name);
				if (!runner?.isRunning)
					throw new Error(`No running teammate: ${name}`);
				await runner.prompt(message_parts.join(' '));
				ctx.ui.notify(`Sent prompt to ${name}`);
				break;
			}
			case 'steer': {
				const [member, ...message_parts] = rest;
				const name = require_arg(member, 'member');
				const runner = runners.get(name);
				if (!runner?.isRunning)
					throw new Error(`No running teammate: ${name}`);
				await runner.steer(message_parts.join(' '));
				ctx.ui.notify(`Steered ${name}`);
				break;
			}
			case 'shutdown': {
				const [member, ...reason_parts] = rest;
				const name = require_arg(member, 'member');
				const runner = runners.get(name);
				if (runner?.isRunning)
					await runner.shutdown(reason_parts.join(' ') || undefined);
				runners.delete(name);
				store.upsert_member(current_team_id(), {
					name,
					status: 'offline',
				});
				set_team_ui(ctx, store, get_active_team_id());
				ctx.ui.notify(`Shutdown requested for ${name}`);
				break;
			}
			case 'wait': {
				const [member] = rest;
				const name = require_arg(member, 'member');
				const runner = runners.get(name);
				if (runner?.isRunning) await runner.waitForIdle();
				set_team_ui(ctx, store, get_active_team_id());
				ctx.ui.notify(
					format_status(store.get_status(current_team_id())),
				);
				break;
			}
			case 'fake': {
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
				set_team_ui(ctx, store, get_active_team_id());
				ctx.ui.notify(result.summary);
				break;
			}
			default:
				ctx.ui.notify(
					'Team commands: /team create [name], /team status, /team ui auto|compact|full|off, /team clear, /team spawn <member> [prompt], /team send <member> <prompt>, /team steer <member> <prompt>, /team wait <member>, /team shutdown <member>, /team task add [name:] <title>, /team dm <member> <msg>, /team inbox [member], /team fake <member>',
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
		observed_completed_task_ids = new Set(
			team_id
				? store
						.list_tasks(team_id)
						.filter((task) => task.status === 'completed')
						.map((task) => task.id)
				: [],
		);
	}

	function poll_team_activity(ctx: ExtensionContext): void {
		if (!active_team_id) {
			set_team_ui(ctx, store, undefined);
			return;
		}
		try {
			if (observed_team_id !== active_team_id) {
				reset_completed_task_observer(active_team_id);
			}
			const status = store.get_status(active_team_id);
			set_team_ui(ctx, store, active_team_id);
			if (own_role !== 'teammate') {
				for (const task of status.tasks) {
					if (
						task.status !== 'completed' ||
						observed_completed_task_ids.has(task.id)
					) {
						continue;
					}
					observed_completed_task_ids.add(task.id);
					const result = summarize_result(task.result);
					ctx.ui.notify(
						`Team task #${task.id} completed${task.assignee ? ` by ${task.assignee}` : ''}: ${task.title}${result ? ` — ${result}` : ''}`,
						'info',
					);
				}
			}
			if (!should_auto_inject_messages()) return;
			const unread = store
				.list_messages(active_team_id, own_member)
				.filter((message) => !message.readAt);
			if (unread.length === 0) return;
			store.mark_messages_read(active_team_id, own_member);
			pi.sendMessage(
				{
					customType: 'team-message',
					content: format_injected_messages(own_member, unread),
					display: true,
					details: { teamId: active_team_id, messages: unread },
				},
				{ deliverAs: 'followUp', triggerTurn: true },
			);
		} catch (error) {
			store.append_event(active_team_id, 'team_activity_poll_error', {
				member: own_member,
				error: error instanceof Error ? error.message : String(error),
			});
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
			store.upsert_member(active_team_id, {
				name: own_member,
				role: own_role === 'teammate' ? 'teammate' : 'lead',
				status: 'idle',
				cwd: ctx.cwd,
				pid: process.pid,
			});
		}
		reset_completed_task_observer(active_team_id);
		set_team_ui(ctx, store, active_team_id);
		start_mailbox_watcher(ctx);
		poll_team_activity(ctx);
	});

	pi.on('session_shutdown', async (_event, ctx) => {
		for (const runner of runners.values()) {
			await runner
				.shutdown('leader session shutting down')
				.catch(() => undefined);
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
				activeTeamId: active_team_id,
				ownMember: own_member,
				ownRole: own_role,
			}),
		};
	});

	pi.registerCommand('team', {
		description:
			'Local experimental teammate-mode store and task board',
		getArgumentCompletions: (prefix) => {
			const subs = [
				'create',
				'id',
				'status',
				'resume',
				'ui auto',
				'ui compact',
				'ui full',
				'ui off',
				'clear',
				'member add',
				'task add',
				'task list',
				'task done',
				'task claim',
				'dm',
				'inbox',
				'spawn',
				'send',
				'steer',
				'wait',
				'shutdown',
				'fake',
			];
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
			),
	});

	pi.registerTool({
		name: 'team',
		label: 'Team',
		description:
			'Manage experimental teammate mode: teams, RPC teammates, tasks, and mailboxes. Real spawning is available through member_spawn; fake_teammate_step is for local tests only.',
		promptSnippet:
			'Manage team-mode members, tasks, messages, and RPC teammate sessions',
		promptGuidelines: [
			'Use team to create and update teammate-mode tasks instead of ad-hoc markdown todo lists when the user asks to coordinate a team.',
			'Use team member_spawn to start real RPC teammates, then assign tasks and inspect status with team_status.',
			'Use team action fake_teammate_step only for local testing/evaluation, not as a real teammate.',
		],
		parameters: TeamToolParams,
		async execute(
			_toolCallId,
			params: TeamToolParams,
			_signal,
			_onUpdate,
			ctx,
		) {
			const team_id = params.teamId ?? active_team_id;
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
					set_team_ui(ctx, store, team.id);
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
								details: { activeTeamId: null, latestTeam: null },
							};
						}
						const status = store.get_status(latest.id);
						return {
							content: [
								{
									type: 'text' as const,
									text: format_status(status),
								},
							],
							details: { ...status, activeTeamId: null },
						};
					}
					const status = store.get_status(team_id);
					set_team_ui(ctx, store, status.team.id);
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
					set_team_ui(ctx, store, undefined);
					return {
						content: [
							{
								type: 'text' as const,
								text: 'Cleared active team UI',
							},
						],
						details: { activeTeamId: null },
					};
				}
				case 'team_ui': {
					const mode = params.mode ?? get_team_ui_mode();
					process.env[TEAM_UI_ENV] = mode;
					set_team_ui(ctx, store, active_team_id);
					return {
						content: [
							{
								type: 'text' as const,
								text: `Team UI mode: ${mode}`,
							},
						],
						details: { mode },
					};
				}
				case 'member_upsert': {
					const member = store.upsert_member(require_team_id(), {
						name: require_arg(params.member ?? params.name, 'member'),
						role: params.role,
						status: params.status,
					});
					set_team_ui(ctx, store, team_id);
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
					const member_name = require_arg(
						params.member ?? params.name,
						'member',
					);
					const runner = new RpcTeammate(store, {
						teamId: require_team_id(),
						member: member_name,
						cwd: ctx.cwd,
						teamRoot: get_team_root(),
						extensionPath: get_extension_path(),
						model:
							params.model ??
							(ctx.model
								? `${ctx.model.provider}/${ctx.model.id}`
								: undefined),
						thinking: params.thinking,
					});
					runners.set(member_name, runner);
					await runner.start();
					if (params.initialPrompt)
						await runner.prompt(params.initialPrompt);
					set_team_ui(ctx, store, team_id);
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
					if (!runner?.isRunning)
						throw new Error(`No running teammate: ${member_name}`);
					const text = require_arg(
						params.message ?? params.initialPrompt,
						'message',
					);
					if (params.action === 'member_steer')
						await runner.steer(text);
					else if (params.action === 'member_follow_up')
						await runner.followUp(text);
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
					if (runner?.isRunning)
						await runner.shutdown(params.message);
					runners.delete(member_name);
					const member = store.upsert_member(require_team_id(), {
						name: member_name,
						status: 'offline',
					});
					set_team_ui(ctx, store, team_id);
					return {
						content: [
							{
								type: 'text' as const,
								text: `Shutdown requested for ${member_name}`,
							},
						],
						details: { member },
					};
				}
				case 'member_status': {
					const status = store.get_status(require_team_id());
					return {
						content: [
							{ type: 'text' as const, text: format_status(status) },
						],
						details: {
							...status,
							runningMembers: [...runners.entries()]
								.filter(([, runner]) => runner.isRunning)
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
					if (!runner?.isRunning) {
						return {
							content: [
								{
									type: 'text' as const,
									text: `${member_name} is not running`,
								},
							],
							details: { member: member_name, running: false },
						};
					}
					await runner.waitForIdle(params.timeoutMs ?? 120_000);
					const status = store.get_status(require_team_id());
					set_team_ui(ctx, store, team_id);
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
						dependsOn: params.dependsOn,
					});
					set_team_ui(ctx, store, team_id);
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
									store.get_status(require_team_id()),
								),
							},
						],
						details: { tasks },
					};
				}
				case 'task_update': {
					const task = store.update_task(
						require_team_id(),
						require_arg(params.taskId, 'taskId'),
						{
							title: params.title,
							description: params.description,
							status: params.taskStatus,
							assignee: params.assignee,
							dependsOn: params.dependsOn,
							result: params.result,
						},
					);
					set_team_ui(ctx, store, team_id);
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
					set_team_ui(ctx, store, team_id);
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
					const message = store.send_message(require_team_id(), {
						from: params.from ?? own_member,
						to: require_arg(params.to, 'to'),
						body: require_arg(params.message, 'message'),
						urgent: params.urgent,
					});
					const runner = runners.get(message.to);
					if (runner?.isRunning) {
						const injected = `<teammate-message from="${message.from}" urgent="${message.urgent}">\n${message.body}\n</teammate-message>`;
						if (message.urgent) await runner.steer(injected);
						else await runner.followUp(injected);
						store.mark_messages_read(require_team_id(), message.to);
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
				case 'message_read': {
					const messages = store.mark_messages_read(
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
				case 'fake_teammate_step': {
					const result = fake_teammate_step(
						store,
						require_team_id(),
						require_arg(params.member ?? params.name, 'member'),
						{
							complete: params.complete,
							shutdownOnMessage: params.shutdownOnMessage,
							result: params.result,
						},
					);
					set_team_ui(ctx, store, team_id);
					return {
						content: [
							{ type: 'text' as const, text: result.summary },
						],
						details: result,
					};
				}
			}
		},
	});
}
