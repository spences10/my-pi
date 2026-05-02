import { require_member_name, safe_segment } from './store-utils.js';
import type { TeamMember, TeamMessage, TeamTask } from './store.js';

export function validate_member(member: TeamMember): void {
	require_member_name(member.name);
	if (!['lead', 'teammate'].includes(member.role)) {
		throw new Error(`Invalid member role: ${member.role}`);
	}
	if (
		![
			'idle',
			'running',
			'running_attached',
			'running_orphaned',
			'blocked',
			'offline',
		].includes(member.status)
	) {
		throw new Error(`Invalid member status: ${member.status}`);
	}
	if (
		member.workspace_mode &&
		!['shared', 'worktree'].includes(member.workspace_mode)
	) {
		throw new Error(
			`Invalid member workspace mode: ${member.workspace_mode}`,
		);
	}
}

export function validate_task(task: TeamTask): void {
	if (safe_segment(task.id) !== task.id) {
		throw new Error(`Invalid task id: ${task.id}`);
	}
	if (!task.title?.trim()) throw new Error('Task title is required');
	if (
		![
			'pending',
			'in_progress',
			'blocked',
			'completed',
			'cancelled',
		].includes(task.status)
	) {
		throw new Error(`Invalid task status: ${task.status}`);
	}
	if (task.assignee) require_member_name(task.assignee, 'assignee');
	if (!Array.isArray(task.depends_on)) {
		throw new Error('Task depends_on must be an array');
	}
	for (const dep_id of task.depends_on) {
		if (safe_segment(dep_id) !== dep_id) {
			throw new Error(`Invalid dependency task id: ${dep_id}`);
		}
	}
}

export function validate_message(message: TeamMessage): void {
	if (safe_segment(message.id) !== message.id) {
		throw new Error(`Invalid message id: ${message.id}`);
	}
	require_member_name(message.from, 'from');
	require_member_name(message.to, 'to');
	if (!message.body?.trim())
		throw new Error('Message body is required');
	if (typeof message.urgent !== 'boolean') {
		throw new Error('Message urgent must be boolean');
	}
}
