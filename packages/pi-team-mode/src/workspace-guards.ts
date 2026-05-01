import { resolve } from 'node:path';
import type { TeamMember } from './store.js';
import { TeamStore } from './store.js';
import type { PreparedTeammateWorkspace } from './workspace.js';

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

export function find_worktree_assignment_conflict(
	members: TeamMember[],
	workspace: PreparedTeammateWorkspace,
): TeamMember | undefined {
	if (workspace.workspace_mode !== 'worktree') return undefined;
	const target_path = workspace.worktree_path
		? resolve(workspace.worktree_path)
		: resolve(workspace.cwd);
	const target_branch = workspace.branch;
	return members.find((member) => {
		if (member.status === 'offline') return false;
		if (member.workspace_mode !== 'worktree') return false;
		const member_path = member.worktree_path ?? member.cwd;
		if (member_path && resolve(member_path) === target_path)
			return true;
		return !!target_branch && member.branch === target_branch;
	});
}

export async function require_no_worktree_assignment_conflict(
	store: TeamStore,
	team_id: string,
	workspace: PreparedTeammateWorkspace,
	member_name: string,
	force = false,
	attached_members: ReadonlySet<string> = new Set(),
): Promise<void> {
	if (force || workspace.workspace_mode !== 'worktree') return;
	const conflict = find_worktree_assignment_conflict(
		await store.refresh_member_process_statuses(
			team_id,
			attached_members,
		),
		workspace,
	);
	if (!conflict) return;
	throw new Error(
		`Refusing to spawn teammate ${member_name} in worktree ${workspace.worktree_path ?? workspace.cwd} because ${conflict.name} is already assigned to that worktree or branch. Use --force only if you have verified the old assignment is safe to override.`,
	);
}

export async function require_no_shared_mutating_conflict(
	store: TeamStore,
	team_id: string,
	cwd: string,
	member_name: string,
	force = false,
	attached_members: ReadonlySet<string> = new Set(),
): Promise<void> {
	if (force) return;
	const conflict = find_shared_mutating_conflict(
		await store.refresh_member_process_statuses(
			team_id,
			attached_members,
		),
		cwd,
		member_name,
	);
	if (!conflict) return;
	throw new Error(
		`Refusing to spawn mutating teammate ${member_name} in shared cwd because ${conflict.name} is already using ${cwd}. Use workspace_mode=worktree or --worktree for write isolation.`,
	);
}
