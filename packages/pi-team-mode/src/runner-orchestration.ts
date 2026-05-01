import { format_rpc_message } from './formatting.js';
import type { RpcTeammate } from './rpc-runner.js';
import {
	TeamStore,
	type TeamMember,
	type TeamMessage,
	type TeamStatus,
} from './store.js';

export async function deliver_message_to_runner(
	store: TeamStore,
	team_id: string,
	runner: RpcTeammate,
	message: TeamMessage,
): Promise<void> {
	const injected = format_rpc_message(message);
	if (message.urgent) await runner.steer(injected);
	else await runner.follow_up(injected);
	await store.mark_messages_delivered(team_id, message.to, [
		message.id,
	]);
}

export function is_pid_alive(pid: number | undefined): boolean {
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

export async function shutdown_orphaned_member(
	store: TeamStore,
	team_id: string,
	member_name: string,
	timeout_ms = 3_000,
): Promise<TeamMember> {
	await store.refresh_member_process_statuses(team_id);
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
		await store.refresh_member_process_statuses(team_id);
		return store
			.list_members(team_id)
			.find((item) => item.name === member_name)!;
	}

	process.kill(member.pid, 'SIGTERM');
	if (!(await wait_for_pid_exit(member.pid, timeout_ms))) {
		process.kill(member.pid, 'SIGKILL');
		await wait_for_pid_exit(member.pid, 1_000);
	}
	await store.refresh_member_process_statuses(team_id);
	store.append_event(team_id, 'member_orphan_shutdown', {
		member: member_name,
		pid: member.pid,
	});
	return store
		.list_members(team_id)
		.find((item) => item.name === member_name)!;
}

export async function wait_for_orphaned_member(
	store: TeamStore,
	team_id: string,
	member_name: string,
	timeout_ms: number,
): Promise<TeamMember> {
	await store.refresh_member_process_statuses(team_id);
	const member = store
		.list_members(team_id)
		.find((item) => item.name === member_name);
	if (!member) throw new Error(`Unknown teammate: ${member_name}`);
	if (!member.pid || !is_pid_alive(member.pid)) {
		await store.refresh_member_process_statuses(team_id);
		return store
			.list_members(team_id)
			.find((item) => item.name === member_name)!;
	}
	if (!(await wait_for_pid_exit(member.pid, timeout_ms))) {
		throw new Error(
			`Timed out waiting for orphaned teammate ${member_name} to exit`,
		);
	}
	await store.refresh_member_process_statuses(team_id);
	return store
		.list_members(team_id)
		.find((item) => item.name === member_name)!;
}

export function attached_member_names(
	runners: Map<string, RpcTeammate>,
): ReadonlySet<string> {
	return new Set(
		[...runners]
			.filter(([, runner]) => runner.is_running)
			.map(([name]) => name),
	);
}

export async function get_team_status(
	store: TeamStore,
	team_id: string,
	runners: Map<string, RpcTeammate>,
): Promise<TeamStatus> {
	return store.get_status(team_id, attached_member_names(runners));
}

export async function get_team_statuses(
	store: TeamStore,
	runners: Map<string, RpcTeammate> = new Map(),
): Promise<TeamStatus[]> {
	const attached = attached_member_names(runners);
	return Promise.all(
		store
			.list_teams()
			.map((team) => store.get_status(team.id, attached)),
	);
}
