import {
	getAgentDir,
	type BeforeAgentStartEvent,
} from '@earendil-works/pi-coding-agent';
import {
	resolve_teammate_profile,
	type TeammateProfile,
} from './profiles.js';
import { get_team_status } from './runner-orchestration.js';
import { TeamStore, type TeamConfig } from './store.js';

export function get_latest_team_for_cwd(
	store: TeamStore,
	cwd: string,
): TeamConfig | undefined {
	return store.list_teams().find((team) => team.cwd === cwd);
}

export function team_has_running_members(
	status: Awaited<ReturnType<typeof get_team_status>>,
): boolean {
	return status.members.some((member) =>
		['running', 'running_attached', 'running_orphaned'].includes(
			member.status,
		),
	);
}

export function team_is_stale(
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

export function find_team_switch_target(
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
		coordination_identity?: string;
		ownMember: string;
		ownRole: string;
	},
): string {
	const role_text =
		options.ownRole === 'teammate' ? 'teammate' : 'team lead';
	const active_context = options.active_team_id
		? `You are ${role_text} \`${options.ownMember}\` in team \`${options.active_team_id}\`.`
		: 'No team is active yet. Create one with the `team` tool when the user asks for parallel/background teammate work.';
	const coordination_identity = options.coordination_identity
		? `\n\n${options.coordination_identity}`
		: '';

	return (
		base_prompt +
		`

## Team Mode

${active_context}${coordination_identity}
Use the \`team\` tool as the source of truth for peer-session and team coordination.

Rules:
- Every my-pi session registers in the global coordination bus. Use session_list to discover sessions across projects and session_send/session_wait to communicate with them.
- If the user mentions standby sessions, existing sessions, subordinates, handoffs, or other active sessions, call session_list and prefer registered standby sessions before member_spawn.
- Inbox states are separate: delivered means queued to a session, read means reviewed, acknowledged means fully processed and safe to suppress redelivery. Use session_read after reviewing peer messages and session_ack after acting on them.
- Use group_create, group_add_session, and group_send when one session should coordinate a group/team of independently running sessions.
- Legacy team tasks and spawned RPC teammates are still available through team_create/task_create/member_spawn when new background sessions are needed.
- Do not create nested spawned teams from a teammate session; teammate sessions cannot use member_spawn or /team spawn.
- Use urgent steer/follow-up messaging for coordination instead of assuming shared context.
- Default to the current shared cwd/branch for teammate work unless the user asks for isolation or a worktree-specific plan is clearly justified.
- Mark file-editing teammates with mutating=true (or /team spawn --mutating); keep shared-cwd mutating work sequential unless ownership is explicitly safe.
- Use workspace_mode=worktree or /team spawn --worktree only after considering repo setup cost, ignored files, ports, databases, and merge/cleanup ownership.
- Shared-cwd mutating teammates may be refused when another mutating teammate is already active in that cwd.`
	);
}

export function require_arg(
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
