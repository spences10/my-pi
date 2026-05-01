import type { TeammateProfile } from './profiles.js';
import type { TeamWorkspaceMode } from './store.js';

function require_arg(
	value: string | undefined,
	name: string,
): string {
	const trimmed = value?.trim();
	if (!trimmed) throw new Error(`${name} is required`);
	return trimmed;
}

export function profile_prompt(
	profile: TeammateProfile | undefined,
	explicit_prompt: string | undefined,
): string {
	return explicit_prompt?.trim() || profile?.prompt || '';
}

export function parse_task_add(text: string): {
	assignee?: string;
	title: string;
} {
	const match = text.match(/^([a-zA-Z0-9_.-]+):\s*(.+)$/);
	if (!match) return { title: text.trim() };
	return { assignee: match[1], title: match[2].trim() };
}

export interface SpawnRequest {
	member: string;
	prompt: string;
	workspace_mode?: TeamWorkspaceMode;
	branch?: string;
	worktree_path?: string;
	profile?: string;
	mutating?: boolean;
	force?: boolean;
}

export function parse_spawn_request(args: string[]): SpawnRequest {
	const [member, ...rest] = args;
	const request: SpawnRequest = {
		member: require_arg(member, 'member'),
		prompt: '',
	};
	const prompt_parts: string[] = [];
	for (let index = 0; index < rest.length; index += 1) {
		const token = rest[index];
		if (token === '--worktree') request.workspace_mode = 'worktree';
		else if (token === '--shared') request.workspace_mode = 'shared';
		else if (token === '--mutating') request.mutating = true;
		else if (token === '--read-only') request.mutating = false;
		else if (token === '--force') request.force = true;
		else if (token === '--branch') {
			request.branch = require_arg(rest[++index], 'branch');
		} else if (token === '--worktree-path') {
			request.worktree_path = require_arg(
				rest[++index],
				'worktree path',
			);
		} else if (token === '--profile' || token === '--agent') {
			request.profile = require_arg(rest[++index], 'profile');
		} else {
			prompt_parts.push(token, ...rest.slice(index + 1));
			break;
		}
	}
	request.prompt = prompt_parts.join(' ').trim();
	return request;
}
