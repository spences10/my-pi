import type { TeamProcessIdentity } from '../process-identity.js';

export type TeamMemberRole = 'lead' | 'teammate';
export type TeamMemberStatus =
	| 'idle'
	| 'running'
	| 'running_attached'
	| 'running_orphaned'
	| 'blocked'
	| 'offline';
export type TeamTaskStatus =
	| 'pending'
	| 'in_progress'
	| 'blocked'
	| 'completed'
	| 'cancelled';
export type TeamWorkspaceMode = 'shared' | 'worktree';

export interface TeamConfig {
	version: 1;
	id: string;
	name: string;
	cwd: string;
	created_at: string;
	updated_at: string;
	next_task_id: number;
}

export interface TeamMember {
	name: string;
	role: TeamMemberRole;
	status: TeamMemberStatus;
	cwd?: string;
	model?: string;
	profile?: string;
	session_file?: string;
	pid?: number;
	process_identity?: TeamProcessIdentity;
	workspace_mode?: TeamWorkspaceMode;
	worktree_path?: string;
	branch?: string;
	mutating?: boolean;
	last_seen_at: string;
	created_at: string;
	updated_at: string;
}

export interface TeamTask {
	id: string;
	title: string;
	description?: string;
	status: TeamTaskStatus;
	assignee?: string;
	depends_on: string[];
	result?: string;
	created_at: string;
	updated_at: string;
	completed_at?: string;
}

export interface TeamMessage {
	id: string;
	from: string;
	to: string;
	body: string;
	urgent: boolean;
	created_at: string;
	reply_to?: string;
	expires_at?: string;
	requires_ack?: boolean;
	delivered_at?: string;
	read_at?: string;
	acknowledged_at?: string;
}

export interface TeamEvent {
	id: string;
	type: string;
	created_at: string;
	data: unknown;
}

export interface CreateTeamInput {
	name?: string;
	cwd: string;
	lead_name?: string;
}

export interface UpsertMemberInput {
	name: string;
	role?: TeamMemberRole;
	status?: TeamMemberStatus;
	cwd?: string;
	model?: string;
	profile?: string;
	session_file?: string;
	pid?: number;
	process_identity?: TeamProcessIdentity;
	workspace_mode?: TeamWorkspaceMode;
	worktree_path?: string;
	branch?: string;
	mutating?: boolean;
}

export interface CreateTaskInput {
	title: string;
	description?: string;
	assignee?: string;
	depends_on?: string[];
	status?: TeamTaskStatus;
}

export interface UpdateTaskInput {
	title?: string;
	description?: string | null;
	status?: TeamTaskStatus;
	assignee?: string | null;
	depends_on?: string[];
	result?: string | null;
}

export interface SendMessageInput {
	from: string;
	to: string;
	body: string;
	urgent?: boolean;
	reply_to?: string;
	ttl_ms?: number;
	requires_ack?: boolean;
}

export interface TeamStatus {
	team: TeamConfig;
	members: TeamMember[];
	tasks: TeamTask[];
	counts: Record<TeamTaskStatus, number>;
}
