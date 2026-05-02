import {
	getAgentDir,
	type BeforeAgentStartEvent,
	type ExtensionCommandContext,
	type ExtensionContext,
} from '@mariozechner/pi-coding-agent';
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
	format_messages,
	format_status,
	format_status_counts,
	format_task_detail,
	format_team_dashboard,
	format_teams_list,
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
import { TeamStore, type TeamConfig } from './store.js';
import {
	confirm_delete_team_modal,
	confirm_prune_teams_modal,
	present_completed_task_results,
	prompt_member_name,
	prompt_task_create,
	prompt_team_name,
	run_task_modal_action,
	show_saved_team_actions_modal,
	show_team_dashboard_modal,
	show_team_home_modal,
	show_team_member_actions_modal,
	show_team_task_action_modal,
	show_team_task_picker,
	show_team_ui_modal,
} from './team-modals.js';
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

function team_has_running_members(
	status: Awaited<ReturnType<typeof get_team_status>>,
): boolean {
	return status.members.some((member) =>
		['running', 'running_attached', 'running_orphaned'].includes(
			member.status,
		),
	);
}

function team_is_stale(
	status: Awaited<ReturnType<typeof get_team_status>>,
	older_than_days: number,
): boolean {
	if (team_has_running_members(status)) return false;
	const timestamp = Date.parse(
		status.team.updated_at ?? status.team.created_at,
	);
	if (!Number.isFinite(timestamp)) return false;
	return Date.now() - timestamp > older_than_days * 86_400_000;
}

function find_team_switch_target(
	store: TeamStore,
	target: string,
): TeamConfig {
	const trimmed = target.trim();
	const teams = store.list_teams();
	const by_id = teams.find((team) => team.id === trimmed);
	if (by_id) return by_id;

	const name_matches = teams.filter(
		(team) => team.name.toLowerCase() === trimmed.toLowerCase(),
	);
	if (name_matches.length === 1) return name_matches[0]!;
	if (name_matches.length > 1) {
		throw new Error(
			`Multiple teams are named ${trimmed}; use the team id instead.`,
		);
	}
	throw new Error(`Unknown team: ${trimmed}`);
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
					while (true) {
						const team_id = await show_team_switcher(
							ctx,
							store,
							get_active_team_id(),
						);
						if (!team_id) break;
						const status = await get_team_status(
							store,
							team_id,
							runners,
						);
						const action = await show_saved_team_actions_modal(
							ctx,
							status,
							get_active_team_id(),
						);
						if (action === 'switch') {
							set_active_team_id(team_id);
							set_team_ui(ctx, store, team_id, runners);
							ctx.ui.notify(
								`Switched to team ${status.team.name} (${status.team.id})`,
							);
							break;
						}
						if (action === 'dashboard') {
							const dashboard_action =
								await show_team_dashboard_modal(ctx, store, status);
							if (dashboard_action === 'results') {
								present_completed_task_results(ctx, status);
							}
						}
						if (action === 'detach') {
							set_active_team_id(undefined);
							set_team_ui(ctx, store, undefined, runners);
							ctx.ui.notify('Detached team UI');
							break;
						}
						if (action === 'delete') {
							if (team_has_running_members(status)) {
								ctx.ui.notify(
									'Shut down running teammates before deleting a team.',
									'warning',
								);
								continue;
							}
							if (
								!(await confirm_delete_team_modal(ctx, status.team))
							) {
								continue;
							}
							await store.delete_team(team_id);
							if (get_active_team_id() === team_id) {
								set_active_team_id(undefined);
								set_team_ui(ctx, store, undefined, runners);
							}
							ctx.ui.notify(
								`Deleted team ${status.team.name} (${status.team.id})`,
								'info',
							);
						}
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
				const target = rest_text
					? find_team_switch_target(store, rest_text).id
					: has_modal_ui(ctx)
						? await show_team_switcher(
								ctx,
								store,
								get_active_team_id(),
							)
						: undefined;
				if (!target) {
					const statuses = await get_team_statuses(store, runners);
					ctx.ui.notify(
						format_teams_list(statuses, get_active_team_id()),
					);
					break;
				}
				set_active_team_id(target);
				set_team_ui(ctx, store, target, runners);
				const team = store.load_team(target);
				ctx.ui.notify(`Switched to team ${team.name} (${team.id})`);
				break;
			}
			case 'clear':
			case 'close':
			case 'detach': {
				set_active_team_id(undefined);
				set_team_ui(ctx, store, undefined, runners);
				ctx.ui.notify('Detached team UI');
				break;
			}
			case 'delete':
			case 'remove': {
				const target = find_team_switch_target(
					store,
					rest_text || current_team_id(),
				);
				const status = await get_team_status(
					store,
					target.id,
					runners,
				);
				if (team_has_running_members(status)) {
					throw new Error(
						'Shut down running teammates before deleting a team.',
					);
				}
				const confirmed = has_modal_ui(ctx)
					? await confirm_delete_team_modal(ctx, status.team)
					: await ctx.ui.confirm(
							'Delete team?',
							`Delete ${status.team.name} (${status.team.id}) from local team storage?`,
						);
				if (!confirmed) break;
				await store.delete_team(target.id);
				if (get_active_team_id() === target.id) {
					set_active_team_id(undefined);
					set_team_ui(ctx, store, undefined, runners);
				}
				ctx.ui.notify(
					`Deleted team ${status.team.name} (${status.team.id})`,
					'info',
				);
				break;
			}
			case 'prune':
			case 'prune-stale': {
				const days_arg = rest.find((item) => /^\d+$/.test(item));
				const days = days_arg ? Number(days_arg) : 14;
				const cwd_only = rest.includes('--cwd');
				const statuses = await get_team_statuses(store, runners);
				const stale = statuses.filter(
					(status) =>
						(!cwd_only || status.team.cwd === ctx.cwd) &&
						team_is_stale(status, days),
				);
				if (stale.length === 0) {
					ctx.ui.notify(
						`No stale teams older than ${days} day(s)${cwd_only ? ' for this cwd' : ''}.`,
					);
					break;
				}
				const confirmed = has_modal_ui(ctx)
					? await confirm_prune_teams_modal(ctx, stale.length, days)
					: await ctx.ui.confirm(
							'Prune stale teams?',
							`Delete ${stale.length} stale team(s) older than ${days} day(s)?`,
						);
				if (!confirmed) break;
				for (const status of stale) {
					await store.delete_team(status.team.id);
				}
				if (
					get_active_team_id() &&
					stale.some(
						(status) => status.team.id === get_active_team_id(),
					)
				) {
					set_active_team_id(undefined);
					set_team_ui(ctx, store, undefined, runners);
				}
				ctx.ui.notify(
					`Deleted ${stale.length} stale team(s).`,
					'info',
				);
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
						'/team teams|switch|resume|detach — manage active team UI',
						'/team delete <id> / prune-stale [days] [--cwd] — remove stored stale teams',
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
