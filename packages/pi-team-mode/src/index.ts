import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { fileURLToPath } from 'node:url';
import {
	append_team_system_prompt,
	handle_team_command,
	should_inject_team_prompt,
} from './command-handler.js';
import {
	get_coordination_db_path,
	get_current_thinking_level,
	get_extension_path,
	get_team_root,
	HEADLESS_ALIAS_ENV,
	HEADLESS_INTENT_ENV,
	HEADLESS_LAUNCH_ENV,
	HEADLESS_PARENT_SESSION_ENV,
	set_current_extension_path,
	should_auto_inject_messages,
	TEAM_MEMBER_ENV,
	TEAM_ROLE_ENV,
} from './config.js';
import {
	CoordinationBrokerClient,
	ensure_coordination_broker,
} from './coordination-broker.js';
import { format_coordination_identity } from './coordination-formatting.js';
import { CoordinationPoller } from './coordination-poller.js';
import { TeamDatabase } from './db/index.js';
import { DefaultHeadlessSessionRunner } from './headless-runner.js';
import {
	detect_standby_registration,
	type StandbyRegistration,
} from './standby.js';
import {
	TeamToolParams,
	validate_team_tool_params,
	type TeamToolParams as TeamToolParamsType,
} from './team-tool-params.js';
import { execute_team_tool } from './tool-executor.js';

function extract_latest_user_text(
	event: unknown,
): string | undefined {
	const prompt = (event as { prompt?: unknown }).prompt;
	return typeof prompt === 'string' ? prompt : undefined;
}

function register_standby_session(
	coordination_db: TeamDatabase,
	session_id: string,
	cwd: string | undefined,
	registration: StandbyRegistration,
): void {
	const session = coordination_db.get_session(session_id);
	if (!session) return;
	coordination_db.register_session({
		session_id,
		session_file: session.session_file,
		cwd: cwd ?? session.cwd,
		agent_name: session.agent_name,
		pid: session.pid,
		role: session.role,
		status: 'idle',
		model_provider: session.model_provider,
		model_id: session.model_id,
		thinking_level: session.thinking_level,
		availability: registration.availability,
		intent: registration.intent,
		session_alias: registration.alias,
		pool: session.pool,
		tags: session.tags,
		metadata: {
			...session.metadata,
			...registration,
		},
	});
}

export {
	handle_team_command,
	should_inject_team_prompt,
	validate_team_tool_params,
};

export default async function team_mode(pi: ExtensionAPI) {
	set_current_extension_path(fileURLToPath(import.meta.url));
	const coordination_db = await TeamDatabase.open(
		get_coordination_db_path(),
	);
	await ensure_coordination_broker();
	let own_session_id: string | undefined;
	let current_cwd: string | undefined;
	const own_member = process.env[TEAM_MEMBER_ENV] || 'peer';
	const own_role = process.env[TEAM_ROLE_ENV] || 'peer';
	const headless_runner = new DefaultHeadlessSessionRunner(
		coordination_db,
	);
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
		current_cwd = ctx.cwd;
		const existing_session =
			coordination_db.get_session(own_session_id);
		coordination_db.register_session({
			session_id: own_session_id,
			session_file: ctx.sessionManager.getSessionFile(),
			cwd: ctx.cwd,
			agent_name:
				pi.getSessionName?.() ||
				process.env.MY_PI_OBSERVABILITY_NAME ||
				process.env[HEADLESS_ALIAS_ENV] ||
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
			thinking_level: get_current_thinking_level(),
			availability: process.env[HEADLESS_LAUNCH_ENV]
				? 'standby'
				: undefined,
			intent: process.env[HEADLESS_INTENT_ENV],
			session_alias: process.env[HEADLESS_ALIAS_ENV],
			parent_session_id: process.env[HEADLESS_PARENT_SESSION_ENV],
			pool: process.env.MY_PI_OBSERVABILITY_POOL || 'default',
			tags: (process.env.MY_PI_OBSERVABILITY_TAG || '')
				.split(',')
				.map((tag) => tag.trim())
				.filter(Boolean),
			metadata: process.env[HEADLESS_LAUNCH_ENV]
				? {
						...existing_session?.metadata,
						launch_mode: process.env[HEADLESS_LAUNCH_ENV],
						alias: process.env[HEADLESS_ALIAS_ENV],
						registered_by: 'child',
						registered_pid: process.pid,
					}
				: existing_session?.metadata,
		});
		coordination_broker.start();
		coordination_poller.start(pi);
		coordination_poller.poll(pi);
	});

	pi.on('session_shutdown', async () => {
		coordination_broker.stop();
		coordination_poller.stop();
		if (own_session_id)
			coordination_db.mark_session_status(own_session_id, 'offline');
	});

	pi.on('before_agent_start', async (event) => {
		const standby_registration = detect_standby_registration(
			extract_latest_user_text(event),
		);
		if (standby_registration && own_session_id) {
			register_standby_session(
				coordination_db,
				own_session_id,
				current_cwd,
				standby_registration,
			);
		}
		if (!should_inject_team_prompt(event)) return {};
		const own_session = own_session_id
			? coordination_db.get_session(own_session_id)
			: undefined;
		const coordination_identity = own_session_id
			? format_coordination_identity(
					coordination_db.list_group_memberships(own_session_id),
					{ thinking_level: own_session?.thinking_level },
				)
			: undefined;
		return {
			systemPrompt: append_team_system_prompt(event.systemPrompt, {
				coordination_identity,
			}),
		};
	});

	pi.registerCommand('team', {
		description:
			'Peer session coordination with groups and mailboxes',
		getArgumentCompletions: (prefix) => {
			const subs = [
				'sessions',
				'session list',
				'session send',
				'session open',
				'session inbox',
				'session read',
				'session ack',
				'group list',
				'group create',
				'group join',
				'group open',
				'group send',
			];
			return subs
				.filter((sub) => sub.startsWith(prefix.trim()))
				.map((sub) => ({ value: sub, label: sub }));
		},
		handler: async (args, ctx) =>
			handle_team_command(
				args,
				ctx,
				coordination_db,
				(to_session_ids, message_id) =>
					coordination_broker.notify_messages(
						to_session_ids,
						message_id,
					),
				() => own_session_id,
				headless_runner,
				{
					team_root: get_team_root(),
					coordination_db_path: get_coordination_db_path(),
					extension_path: get_extension_path(),
				},
			),
	});

	pi.registerTool({
		name: 'team',
		label: 'Team',
		description:
			'Manage peer session coordination, groups, artifacts, and mailboxes.',
		promptSnippet:
			'Manage peer sessions, coordination groups, artifacts, and messages',
		promptGuidelines: [
			'Use team session_list to discover registered Pi sessions across projects before sending peer messages.',
			'If the user mentions standby sessions, existing sessions, subordinates, handoffs, or other active sessions, call session_list and prefer registered standby sessions.',
			'For session_open, put the teammate alias in member. name is accepted only as a compatibility alias for older prompts.',
			'Use session_send for handoffs that should appear as normal visible user messages in the teammate session transcript.',
			'Prefer existing standby sessions for delegation; use session_open only when the user asks to create or resume a teammate session.',
			'Use artifact_create, artifact_get, and artifact_list for larger handoffs, plans, findings, logs, diffs, or results; send artifact ids instead of pasting very large bodies.',
			'Use team group_create, group_add_session, and group_send when one session should coordinate a group of independently running sessions.',
			'Use session_list and group_list as the source of truth for peer-session coordination.',
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
				coordination_db,
				notify_coordination_messages: (to_session_ids, message_id) =>
					coordination_broker.notify_messages(
						to_session_ids,
						message_id,
					),
				get_session_id: () => own_session_id,
				headless_runner,
				headless_defaults: {
					team_root: get_team_root(),
					coordination_db_path: get_coordination_db_path(),
					extension_path: get_extension_path(),
				},
			});
		},
	});
}
