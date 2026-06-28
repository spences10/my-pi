import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { fileURLToPath } from 'node:url';
import { TeamActivityPoller } from './activity-poller.js';
import {
	append_team_system_prompt,
	handle_team_command,
	require_lead_for_teammate_spawn,
	should_inject_team_prompt,
	teammate_profile,
} from './command-handler.js';
import {
	ACTIVE_TEAM_ENV,
	get_coordination_db_path,
	get_extension_path,
	get_team_root,
	set_current_extension_path,
	should_auto_inject_messages,
	should_enable_fake_teammate_command,
	TEAM_MEMBER_ENV,
	TEAM_ROLE_ENV,
} from './config.js';
import {
	CoordinationBrokerClient,
	ensure_coordination_broker,
} from './coordination-broker.js';
import { CoordinationPoller } from './coordination-poller.js';
import { TeamDatabase } from './db.js';
import {
	format_completed_task_results,
	format_team_dashboard,
} from './formatting.js';
import { capture_process_identity } from './process-identity.js';
import { RpcTeammate } from './rpc-runner.js';
import { TeamStore } from './store.js';
import {
	TeamToolParams,
	validate_team_tool_params,
	type TeamToolParams as TeamToolParamsType,
} from './team-tool-params.js';
import { execute_team_tool } from './tool-executor.js';
import {
	get_team_ui_mode,
	get_team_ui_style,
	set_team_ui,
	should_show_team_widget,
	STATUS_KEY,
} from './ui-status.js';
import {
	find_shared_mutating_conflict,
	find_worktree_assignment_conflict,
} from './workspace-guards.js';

export {
	find_shared_mutating_conflict,
	find_worktree_assignment_conflict,
	format_completed_task_results,
	format_team_dashboard,
	get_team_ui_mode,
	get_team_ui_style,
	handle_team_command,
	require_lead_for_teammate_spawn,
	should_inject_team_prompt,
	should_show_team_widget,
	validate_team_tool_params,
};

export default async function team_mode(pi: ExtensionAPI) {
	set_current_extension_path(fileURLToPath(import.meta.url));
	const store = new TeamStore(get_team_root());
	const coordination_db = await TeamDatabase.open(
		get_coordination_db_path(),
	);
	await ensure_coordination_broker();
	const runners = new Map<string, RpcTeammate>();
	let active_team_id: string | undefined;
	let own_session_id: string | undefined;
	const own_member = process.env[TEAM_MEMBER_ENV] || 'lead';
	const own_role = process.env[TEAM_ROLE_ENV] || 'lead';
	const activity_poller = new TeamActivityPoller({
		store,
		runners,
		own_member,
		own_role,
		get_active_team_id: () => active_team_id,
		clear_active_team_id: () => {
			active_team_id = undefined;
		},
		should_auto_inject_messages,
	});
	const coordination_poller = new CoordinationPoller({
		db: coordination_db,
		get_session_id: () => own_session_id,
		should_auto_inject_messages,
	});
	const coordination_broker = new CoordinationBrokerClient({
		get_session_id: () => own_session_id,
		on_message: () => coordination_poller.poll(pi),
	});

	pi.on('session_start', async (_event, ctx) => {
		own_session_id = ctx.sessionManager.getSessionId();
		coordination_db.register_session({
			session_id: own_session_id,
			session_file: ctx.sessionManager.getSessionFile(),
			cwd: ctx.cwd,
			agent_name:
				pi.getSessionName?.() ||
				process.env.MY_PI_OBSERVABILITY_NAME ||
				(process.env[TEAM_MEMBER_ENV] ? own_member : undefined),
			pid: process.pid,
			role: process.env[TEAM_ROLE_ENV]
				? own_role === 'teammate'
					? 'teammate'
					: 'lead'
				: 'peer',
			status: 'online',
			model_provider: ctx.model?.provider,
			model_id: ctx.model?.id,
			pool: process.env.MY_PI_OBSERVABILITY_POOL || 'default',
			tags: (process.env.MY_PI_OBSERVABILITY_TAG || '')
				.split(',')
				.map((tag) => tag.trim())
				.filter(Boolean),
			metadata: { active_team_id: process.env[ACTIVE_TEAM_ENV] },
		});
		active_team_id = process.env[ACTIVE_TEAM_ENV];
		if (active_team_id) {
			try {
				store.load_team(active_team_id);
				await store.clear_unacknowledged_deliveries(
					active_team_id,
					own_member,
				);
				await store.upsert_member(active_team_id, {
					name: own_member,
					role: own_role === 'teammate' ? 'teammate' : 'lead',
					status: 'idle',
					cwd: ctx.cwd,
					pid: process.pid,
					process_identity:
						own_role === 'teammate'
							? capture_process_identity(process.pid, {
									marker: '--session-dir',
								})
							: undefined,
				});
			} catch {
				active_team_id = undefined;
			}
		}
		activity_poller.reset(active_team_id);
		set_team_ui(ctx, store, active_team_id, runners);
		activity_poller.start(pi, ctx);
		coordination_broker.start();
		coordination_poller.start(pi);
		void activity_poller.poll(pi, ctx);
		coordination_poller.poll(pi);
	});

	pi.on('session_shutdown', async (_event, ctx) => {
		for (const runner of runners.values()) {
			await runner
				.shutdown('leader session shutting down')
				.catch(() => undefined);
		}
		if (active_team_id) {
			try {
				await store.clear_unacknowledged_deliveries(
					active_team_id,
					own_member,
				);
			} catch {
				// Ignore shutdown cleanup failures.
			}
		}
		runners.clear();
		activity_poller.stop();
		coordination_broker.stop();
		coordination_poller.stop();
		if (own_session_id)
			coordination_db.mark_session_status(own_session_id, 'offline');
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
				'sessions',
				'session list',
				'session send',
				'session inbox',
				'session read',
				'session ack',
				'group list',
				'group create',
				'group join',
				'group send',
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
				'inbox alice read',
				'inbox alice ack',
				'read',
				'ack',
				...(own_role === 'teammate'
					? []
					: ['spawn', 'spawn alice --worktree --mutating']),
				'send',
				'steer',
				'wait',
				'shutdown --done',
				'shutdown --all',
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
					activity_poller.reset(team_id);
				},
				own_role,
				coordination_db,
				(to_session_ids, message_id) =>
					coordination_broker.notify_messages(
						to_session_ids,
						message_id,
					),
				() => own_session_id,
			),
	});

	pi.registerTool({
		name: 'team',
		label: 'Team',
		description:
			'Manage peer session coordination, groups, RPC teammates, tasks, and mailboxes. Real spawning is available through member_spawn.',
		promptSnippet:
			'Manage peer sessions, coordination groups, tasks, messages, and optional RPC teammate sessions',
		promptGuidelines: [
			'Use team session_list to discover registered Pi sessions across projects before sending peer messages.',
			'Use team session_send, session_inbox, session_read, session_ack, and session_wait for peer-session mailbox coordination.',
			'Use team group_create, group_add_session, and group_send when one session should coordinate a team of independently running sessions.',
			'Use team to create and update teammate-mode tasks instead of ad-hoc markdown todo lists when the user asks to coordinate a team.',
			'Only team leads may use member_spawn. Teammate sessions must not spawn nested teammates.',
			'Use team member_spawn to start real RPC teammates when new sessions are needed; spawned sessions register into the same coordination bus.',
			'Use session_list, session_inbox, and group_list as the source of truth for peer-session coordination; use team_status for spawned RPC process state.',
		],
		parameters: TeamToolParams,
		async execute(
			_toolCallId,
			params: TeamToolParamsType,
			_signal,
			_onUpdate,
			ctx,
		) {
			return execute_team_tool(params, ctx, {
				store,
				runners,
				own_role,
				own_member,
				get_active_team_id: () => active_team_id,
				set_active_team_id: (team_id) => {
					active_team_id = team_id;
				},
				reset_activity: (team_id) => activity_poller.reset(team_id),
				get_team_root,
				get_extension_path,
				teammate_profile,
				coordination_db,
				notify_coordination_messages: (to_session_ids, message_id) =>
					coordination_broker.notify_messages(
						to_session_ids,
						message_id,
					),
				get_session_id: () => own_session_id,
			});
		},
	});
}
