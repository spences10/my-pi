import { require_member_name } from '../store-utils.js';
import type { TeamMember, UpsertMemberInput } from './types.js';

export function build_member_record(
	input: UpsertMemberInput,
	existing: TeamMember | undefined,
	timestamp: string,
): TeamMember {
	const name = require_member_name(input.name);
	const workspace_mode =
		input.workspace_mode ?? existing?.workspace_mode;
	const worktree_path =
		workspace_mode === 'worktree'
			? (input.worktree_path ?? existing?.worktree_path)
			: undefined;
	const branch =
		workspace_mode === 'worktree'
			? (input.branch ?? existing?.branch)
			: undefined;
	return {
		name,
		role: input.role ?? existing?.role ?? 'teammate',
		status: input.status ?? existing?.status ?? 'idle',
		...((input.cwd ?? existing?.cwd)
			? { cwd: input.cwd ?? existing?.cwd }
			: {}),
		...((input.model ?? existing?.model)
			? { model: input.model ?? existing?.model }
			: {}),
		...((input.profile ?? existing?.profile)
			? { profile: input.profile ?? existing?.profile }
			: {}),
		...((input.session_file ?? existing?.session_file)
			? { session_file: input.session_file ?? existing?.session_file }
			: {}),
		...((input.pid ?? existing?.pid)
			? { pid: input.pid ?? existing?.pid }
			: {}),
		...((input.process_identity ?? existing?.process_identity)
			? {
					process_identity:
						input.process_identity ?? existing?.process_identity,
				}
			: {}),
		...(workspace_mode ? { workspace_mode: workspace_mode } : {}),
		...(worktree_path ? { worktree_path: worktree_path } : {}),
		...(branch ? { branch } : {}),
		...(input.mutating !== undefined
			? { mutating: input.mutating }
			: existing?.mutating
				? { mutating: existing.mutating }
				: {}),
		last_seen_at: timestamp,
		created_at: existing?.created_at ?? timestamp,
		updated_at: timestamp,
	};
}
