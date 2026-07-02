import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import {
	parse_team_thinking_level,
	profile_prompt,
} from './command-parser.js';
import type { TeamDatabase } from './db.js';
import { format_status, format_teams_list } from './formatting.js';
import { select_teammate_model_config } from './model-selection.js';
import type { TeammateProfile } from './profiles.js';
import { RpcTeammate } from './rpc-runner.js';
import { is_standby_session } from './standby.js';
import {
	attached_member_names,
	get_team_status,
	get_team_statuses,
	shutdown_orphaned_member,
	shutdown_team_members,
} from './runner-orchestration.js';
import {
	TeamStore,
	type TeamConfig,
	type TeamMember,
} from './store.js';
import {
	validate_team_tool_params,
	type TeamToolParams as TeamToolParamsType,
} from './team-tool-params.js';
import { execute_coordination_action } from './tools/coordination-actions.js';
import { execute_message_action } from './tools/message-actions.js';
import {
	execute_task_action,
	require_arg,
} from './tools/task-actions.js';
import {
	get_team_ui_mode,
	get_team_ui_style,
	set_team_ui,
	TEAM_UI_ENV,
	TEAM_UI_STYLE_ENV,
} from './ui-status.js';
import {
	require_no_shared_mutating_conflict,
	require_no_worktree_assignment_conflict,
} from './workspace-guards.js';
import { prepare_teammate_workspace } from './workspace.js';

export interface TeamToolExecutorDeps {
	store: TeamStore;
	runners: Map<string, RpcTeammate>;
	own_role: string;
	own_member: string;
	get_active_team_id: () => string | undefined;
	set_active_team_id: (team_id: string | undefined) => void;
	reset_activity: (team_id: string | undefined) => void;
	get_team_root: () => string;
	get_extension_path: () => string;
	teammate_profile: (
		cwd: string,
		name: string | undefined,
	) => TeammateProfile | undefined;
	coordination_db: TeamDatabase;
	notify_coordination_messages: (
		to_session_ids: string[],
		message_id?: string,
	) => Promise<void>;
	get_session_id: () => string | undefined;
}

function require_lead_for_teammate_spawn(
	own_role: string | undefined,
): void {
	if (own_role?.trim().toLowerCase() !== 'teammate') return;
	throw new Error(
		'Only team leads can spawn teammates. Teammate sessions cannot create nested teams.',
	);
}

function get_latest_team_for_cwd(
	store: TeamStore,
	cwd: string,
): TeamConfig | undefined {
	return store.list_teams().find((team) => team.cwd === cwd);
}

export async function execute_team_tool(
	params: TeamToolParamsType,
	ctx: ExtensionContext,
	deps: TeamToolExecutorDeps,
) {
	const { store, runners, own_role, own_member } = deps;
	let active_team_id = deps.get_active_team_id();
	const set_active_team_id = (team_id: string | undefined) => {
		active_team_id = team_id;
		deps.set_active_team_id(team_id);
	};
	const get_team_root = deps.get_team_root;
	const get_extension_path = deps.get_extension_path;
	const teammate_profile = deps.teammate_profile;
	const coordination_db = deps.coordination_db;
	const require_session_id = () => {
		const session_id = deps.get_session_id();
		if (!session_id)
			throw new Error('Current session is not registered yet.');
		return session_id;
	};

	validate_team_tool_params(params);
	const team_id = params.team_id ?? active_team_id;
	const require_team_id = () => {
		if (!team_id)
			throw new Error(
				'No active team. Use action team_create first.',
			);
		return team_id;
	};

	switch (params.action) {
		case 'session_list':
		case 'session_send':
		case 'session_inbox':
		case 'session_wait':
		case 'session_read':
		case 'session_ack':
		case 'group_create':
		case 'group_list':
		case 'group_join':
		case 'group_add_session':
		case 'group_send':
			return execute_coordination_action(params, {
				ctx,
				coordination_db,
				notify_coordination_messages:
					deps.notify_coordination_messages,
				require_session_id,
			});
		case 'team_create': {
			const team = store.create_team({
				cwd: ctx.cwd,
				name: params.name,
			});
			set_active_team_id(team.id);
			deps.reset_activity(team.id);
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
			const statuses = await get_team_statuses(store, runners);
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
				const status = await get_team_status(
					store,
					latest.id,
					runners,
				);
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
			const status = await get_team_status(store, team_id, runners);
			set_team_ui(ctx, store, status.team.id, runners);
			return {
				content: [
					{ type: 'text' as const, text: format_status(status) },
				],
				details: status,
			};
		}
		case 'team_clear': {
			set_active_team_id(undefined);
			deps.reset_activity(undefined);
			set_team_ui(ctx, store, undefined, runners);
			return {
				content: [
					{
						type: 'text' as const,
						text: 'Detached team UI',
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
		case 'team_shutdown': {
			const mode = params.member === 'all' ? 'all' : 'done';
			const result = await shutdown_team_members(
				store,
				require_team_id(),
				runners,
				mode,
				params.message,
				params.timeout_ms ?? 3_000,
			);
			set_team_ui(ctx, store, team_id, runners);
			const suffix = result.errors.length
				? `; ${result.errors.length} failed`
				: '';
			return {
				content: [
					{
						type: 'text' as const,
						text: `Shutdown ${result.members.length} teammate${result.members.length === 1 ? '' : 's'}${suffix}`,
					},
				],
				details: result,
			};
		}
		case 'member_upsert': {
			const member = await store.upsert_member(require_team_id(), {
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
			const standby_sessions = coordination_db
				.list_sessions()
				.filter(
					(session) =>
						session.cwd === ctx.cwd &&
						is_standby_session(session.metadata) &&
						session.session_id !== deps.get_session_id(),
				);
			if (standby_sessions.length > 0 && !params.force) {
				throw new Error(
					`Registered standby session${standby_sessions.length === 1 ? '' : 's'} exist in this cwd: ${standby_sessions.map((session) => session.session_id).join(', ')}. Use session_send/session_list to coordinate with them, or set force: true to spawn a new teammate anyway.`,
				);
			}
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
			await require_no_worktree_assignment_conflict(
				store,
				id,
				workspace,
				member_name,
				params.force,
				attached_member_names(runners),
			);
			if (params.mutating && workspace.workspace_mode === 'shared') {
				await require_no_shared_mutating_conflict(
					store,
					id,
					workspace.cwd,
					member_name,
					params.force,
					attached_member_names(runners),
				);
			}
			const thinking = parse_team_thinking_level(params.thinking);
			const model_config = select_teammate_model_config({
				requested_model: params.model,
				profile_model: profile?.model,
				current_model: ctx.model as any,
				model_registry: ctx.modelRegistry,
				requested_thinking: thinking,
				profile_thinking: profile?.thinking,
			});
			const runner = new RpcTeammate(store, {
				team_id: id,
				member: member_name,
				cwd: workspace.cwd,
				team_root: get_team_root(),
				extension_path: get_extension_path(),
				model: model_config.model,
				thinking: model_config.thinking,
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
			if (params.action === 'member_steer') await runner.steer(text);
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
				member = await store.upsert_member(require_team_id(), {
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
			const status = await get_team_status(
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
			const status = await get_team_status(
				store,
				require_team_id(),
				runners,
			);
			set_team_ui(ctx, store, team_id, runners);
			return {
				content: [
					{
						type: 'text' as const,
						text: `Not blocking on ${member_name}; teammate work remains in the background. Current status:\n\n${format_status(status)}`,
					},
				],
				details: { ...status, waiting: false, member: member_name },
			};
		}
		case 'task_create':
		case 'task_list':
		case 'task_get':
		case 'task_update':
		case 'task_claim_next':
			return execute_task_action(params, {
				ctx,
				store,
				runners,
				team_id,
				require_team_id,
			});
		case 'message_send':
		case 'message_list':
		case 'message_wait':
		case 'message_read':
		case 'message_ack':
			return execute_message_action(params, {
				store,
				runners,
				own_member,
				require_team_id,
			});
	}
}
