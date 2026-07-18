import type { ToolCallEvent } from '@earendil-works/pi-coding-agent';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
	get_git_recoverability,
	git,
	is_git_recoverable,
} from './git.js';
import { describe_path_risk, is_agent_temp_path } from './paths.js';
import {
	extract_command_paths,
	extract_overwrite_paths,
	extract_shell_invocations,
	type ShellInvocation,
} from './shell.js';
import type { DestructiveAction } from './types.js';

const DESTRUCTIVE_CUSTOM_TOOL_NAME =
	/(^|[_-])(delete|destroy|drop|remove|archive|execute_write_query|execute_schema_query|bulk_insert)([_-]|$)/i;
const DYNAMIC_PATH_PATTERN = /[*?[$`]|\$\(|\$\{/;
const SAFE_REDIRECT_TARGETS = new Set([
	'/dev/null',
	'/dev/stderr',
	'/dev/stdout',
	'/dev/tty',
]);

function preview(value: string, max = 500): string {
	const normalized = value.trim().replace(/\s+/g, ' ');
	return normalized.length > max
		? `${normalized.slice(0, max - 1)}…`
		: normalized;
}

function destructive_action(
	command: string,
	reason: string,
	allow_key: string,
	title = 'Confirm destructive command?',
): DestructiveAction {
	return {
		title,
		description: `${reason}: ${preview(command)}`,
		reason,
		allow_key,
	};
}

function is_command(
	invocation: ShellInvocation,
	command: string,
): boolean {
	return invocation.command === command;
}

function has_sequence(args: string[], sequence: string[]): boolean {
	const lowered = args.map((arg) => arg.toLowerCase());
	return lowered.some((_, index) =>
		sequence.every(
			(value, offset) => lowered[index + offset] === value,
		),
	);
}

function option_letters(args: string[]): string {
	return args
		.filter((arg) => /^-[^-]/.test(arg))
		.map((arg) => arg.slice(1))
		.join('');
}

function assess_rm_command(
	command: string,
	cwd: string,
	invocations: ShellInvocation[],
	session_created_paths: ReadonlySet<string> = new Set(),
): DestructiveAction | undefined {
	const removes = invocations.filter((invocation) =>
		['rm', 'rmdir', 'shred', 'unlink'].includes(invocation.command),
	);
	if (removes.length === 0) return undefined;

	const paths = extract_command_paths(command, 'rm');
	if (paths && paths.length > 0) {
		if (
			paths.every((path) => {
				const absolute = resolve(cwd, path);
				return (
					session_created_paths.has(absolute) ||
					is_agent_temp_path(absolute)
				);
			})
		) {
			return undefined;
		}
		if (paths.every((path) => is_git_recoverable(cwd, path))) {
			return undefined;
		}
	}

	const reason = paths?.length
		? describe_path_risk(cwd, paths)
		: 'Deletes files or directories';
	return destructive_action(command, reason, 'bash:rm-risky');
}

function assess_git_rm_command(
	command: string,
	cwd: string,
	invocations: ShellInvocation[],
): DestructiveAction | undefined {
	const removals = invocations.filter(
		(invocation) =>
			is_command(invocation, 'git') && invocation.args[0] === 'rm',
	);
	if (removals.length === 0) return undefined;
	if (
		removals.some((invocation) =>
			invocation.args.some(
				(arg) => arg === '--force' || /^-[^-]*f/.test(arg),
			),
		)
	) {
		return destructive_action(
			command,
			'Force-removes files from git',
			'bash:git-rm-force',
			'Confirm forced git removal?',
		);
	}

	const paths = extract_command_paths(command, 'git-rm');
	if (
		paths &&
		paths.length > 0 &&
		paths.every((path) => is_git_recoverable(cwd, path))
	) {
		return undefined;
	}

	const reason = paths?.length
		? describe_path_risk(cwd, paths)
		: 'Deletes tracked files from git';
	return destructive_action(
		command,
		reason,
		'bash:git-rm-risky',
		'Confirm git removal?',
	);
}

function assess_git_reset_hard(
	command: string,
	cwd: string,
	invocations: ShellInvocation[],
): DestructiveAction | undefined {
	const resets_hard = invocations.some(
		(invocation) =>
			is_command(invocation, 'git') &&
			invocation.args[0] === 'reset' &&
			invocation.args.includes('--hard'),
	);
	if (!resets_hard || git(['status', '--porcelain=v1'], cwd) === '') {
		return undefined;
	}
	return destructive_action(
		command,
		'Discards uncommitted tracked changes',
		'bash:git-reset-hard',
		'Confirm hard reset?',
	);
}

function assess_git_force_push(
	command: string,
	invocations: ShellInvocation[],
): DestructiveAction | undefined {
	const force_push = invocations.some(
		(invocation) =>
			is_command(invocation, 'git') &&
			invocation.args[0] === 'push' &&
			invocation.args.some(
				(arg) =>
					arg === '--force' ||
					arg === '--force-with-lease' ||
					arg === '--force-if-includes' ||
					/^-[^-]*f/.test(arg),
			),
	);
	if (!force_push) return undefined;
	return destructive_action(
		command,
		'Overwrites remote git history',
		'bash:git-force-push',
		'Confirm force push?',
	);
}

function assess_overwrite_redirect(
	command: string,
	cwd: string,
	session_created_paths: ReadonlySet<string>,
): DestructiveAction | undefined {
	const paths = extract_overwrite_paths(command);
	if (paths.length === 0) return undefined;

	const risky = paths.filter((path) => {
		if (SAFE_REDIRECT_TARGETS.has(path)) return false;
		if (DYNAMIC_PATH_PATTERN.test(path)) return true;
		const absolute = resolve(cwd, path);
		if (!existsSync(absolute)) return false;
		return (
			!session_created_paths.has(absolute) &&
			!is_agent_temp_path(absolute) &&
			!is_git_recoverable(cwd, path)
		);
	});
	if (risky.length === 0) return undefined;

	return destructive_action(
		command,
		'Truncates or overwrites file contents that git cannot restore',
		'bash:redirect-overwrite',
	);
}

function assess_known_destructive_intent(
	command: string,
	invocations: ShellInvocation[],
): DestructiveAction | undefined {
	for (const invocation of invocations) {
		const args = invocation.args;
		const lower_args = args.map((arg) => arg.toLowerCase());
		const joined = lower_args.join(' ');

		if (
			is_command(invocation, 'prisma') &&
			(has_sequence(lower_args, ['migrate', 'reset']) ||
				has_sequence(lower_args, ['db', 'execute']) ||
				(has_sequence(lower_args, ['db', 'push']) &&
					lower_args.includes('--force-reset')))
		) {
			return destructive_action(
				command,
				'Runs a potentially destructive Prisma database operation',
				'bash:prisma-destructive',
			);
		}
		if (
			['psql', 'mysql', 'mariadb', 'sqlite3'].includes(
				invocation.command,
			) &&
			/\b(drop|delete\s+from|truncate|alter\s+table|update\s+\S+\s+set)\b/i.test(
				joined,
			)
		) {
			return destructive_action(
				command,
				'Runs destructive SQL through a database CLI',
				'bash:db-cli-destructive-sql',
			);
		}
		if (
			is_command(invocation, 'find') &&
			lower_args.includes('-delete')
		) {
			return destructive_action(
				command,
				'Deletes files found by find',
				'bash:find-delete',
			);
		}
		if (
			is_command(invocation, 'git') &&
			lower_args[0] === 'clean' &&
			(lower_args.includes('--force') ||
				option_letters(lower_args.slice(1)).includes('f'))
		) {
			return destructive_action(
				command,
				'Deletes untracked files or directories',
				'bash:git-clean',
			);
		}
		if (
			is_command(invocation, 'git') &&
			['checkout', 'restore'].includes(lower_args[0] ?? '') &&
			lower_args.at(-1) === '.'
		) {
			return destructive_action(
				command,
				'Discards working tree changes',
				'bash:git-discard-all',
			);
		}
		if (
			is_command(invocation, 'rsync') &&
			lower_args.includes('--delete')
		) {
			return destructive_action(
				command,
				'Deletes destination files during sync',
				'bash:rsync-delete',
			);
		}
		if (
			is_command(invocation, 'truncate') &&
			/(?:^|\s)(?:-s\s*0|--size(?:=|\s+)0)(?:\s|$)/.test(joined)
		) {
			return destructive_action(
				command,
				'Empties file contents',
				'bash:truncate-zero',
			);
		}
		if (
			is_command(invocation, 'dd') &&
			lower_args.some((arg) => arg.startsWith('of='))
		) {
			return destructive_action(
				command,
				'Overwrites a device or file with dd',
				'bash:dd-output',
			);
		}
		if (
			['mkfs', 'fdisk', 'parted', 'wipefs'].includes(
				invocation.command,
			)
		) {
			return destructive_action(
				command,
				'Modifies disks or filesystems',
				'bash:disk-tool',
			);
		}
		if (
			is_command(invocation, 'sed') &&
			lower_args.some(
				(arg) =>
					arg === '-i' ||
					arg.startsWith('-i') ||
					arg === '--in-place' ||
					arg.startsWith('--in-place='),
			)
		) {
			return destructive_action(
				command,
				'Edits files in place with sed',
				'bash:sed-in-place',
			);
		}
		if (
			is_command(invocation, 'git') &&
			lower_args[0] === 'stash' &&
			['drop', 'clear'].includes(lower_args[1] ?? '')
		) {
			return destructive_action(
				command,
				'Deletes git stash entries',
				'bash:git-stash-delete',
			);
		}
		if (
			is_command(invocation, 'git') &&
			lower_args[0] === 'branch' &&
			(args.includes('-D') ||
				(lower_args.includes('--delete') &&
					lower_args.includes('--force')) ||
				(option_letters(lower_args.slice(1)).includes('d') &&
					option_letters(lower_args.slice(1)).includes('f')))
		) {
			return destructive_action(
				command,
				'Force-deletes a git branch',
				'bash:git-branch-force-delete',
			);
		}
		if (
			is_command(invocation, 'git') &&
			lower_args[0] === 'push' &&
			(lower_args.includes('--delete') ||
				option_letters(lower_args.slice(1)).includes('d') ||
				lower_args.some((arg) => /^:[^:]/.test(arg)))
		) {
			return destructive_action(
				command,
				'Deletes a remote git ref',
				'bash:git-push-delete',
			);
		}
		if (
			is_command(invocation, 'docker') &&
			has_sequence(lower_args, ['system', 'prune'])
		) {
			return destructive_action(
				command,
				'Deletes unused Docker data',
				'bash:docker-system-prune',
			);
		}
		if (is_command(invocation, 'dropdb')) {
			return destructive_action(
				command,
				'Drops a PostgreSQL database',
				'bash:dropdb',
			);
		}
		if (
			is_command(invocation, 'redis-cli') &&
			lower_args.some((arg) => ['flushall', 'flushdb'].includes(arg))
		) {
			return destructive_action(
				command,
				'Deletes Redis database contents',
				'bash:redis-flush',
			);
		}
		if (
			is_command(invocation, 'terraform') &&
			lower_args.includes('destroy')
		) {
			return destructive_action(
				command,
				'Destroys Terraform-managed infrastructure',
				'bash:terraform-destroy',
			);
		}
		if (
			is_command(invocation, 'aws') &&
			has_sequence(lower_args, ['s3', 'rm']) &&
			lower_args.includes('--recursive')
		) {
			return destructive_action(
				command,
				'Recursively deletes S3 objects',
				'bash:aws-s3-rm-recursive',
			);
		}
		if (
			is_command(invocation, 'kubectl') &&
			lower_args.includes('delete')
		) {
			return destructive_action(
				command,
				'Deletes Kubernetes resources',
				'bash:kubectl-delete',
			);
		}
	}
	return undefined;
}

export function assess_bash_command(
	command: string,
	cwd = process.cwd(),
	session_created_paths: ReadonlySet<string> = new Set(),
): DestructiveAction | undefined {
	const normalized = command.trim();
	if (!normalized) return undefined;
	const invocations = extract_shell_invocations(normalized);

	return (
		assess_rm_command(
			normalized,
			cwd,
			invocations,
			session_created_paths,
		) ??
		assess_git_rm_command(normalized, cwd, invocations) ??
		assess_git_reset_hard(normalized, cwd, invocations) ??
		assess_git_force_push(normalized, invocations) ??
		assess_overwrite_redirect(
			normalized,
			cwd,
			session_created_paths,
		) ??
		assess_known_destructive_intent(normalized, invocations)
	);
}

function assess_file_write(
	cwd: string,
	path: unknown,
	session_created_paths: ReadonlySet<string> = new Set(),
): DestructiveAction | undefined {
	if (typeof path !== 'string' || !path.trim()) return undefined;
	const absolute = resolve(cwd, path);
	if (!existsSync(absolute)) return undefined;
	if (session_created_paths.has(absolute)) return undefined;
	if (is_git_recoverable(cwd, path)) return undefined;

	const reason =
		get_git_recoverability(cwd, path) === 'tracked-dirty'
			? 'Overwrites a file with uncommitted changes'
			: 'Overwrites an untracked file git cannot restore';

	return {
		title: 'Confirm file overwrite?',
		description: `${reason}: ${path}`,
		reason,
		allow_key: 'write:risky-overwrite',
	};
}

function assess_file_edit(
	cwd: string,
	input: Record<string, unknown>,
	session_created_paths: ReadonlySet<string> = new Set(),
): DestructiveAction | undefined {
	const path =
		typeof input.path === 'string' ? input.path : undefined;
	const edits = Array.isArray(input.edits) ? input.edits : [];
	let removed_chars = 0;
	let added_chars = 0;

	for (const edit of edits) {
		if (!edit || typeof edit !== 'object') continue;
		const old_text = (edit as { oldText?: unknown }).oldText;
		const new_text = (edit as { newText?: unknown }).newText;
		if (typeof old_text === 'string')
			removed_chars += old_text.length;
		if (typeof new_text === 'string') added_chars += new_text.length;
	}

	if (removed_chars === 0 || removed_chars - added_chars < 200)
		return undefined;
	if (path && session_created_paths.has(resolve(cwd, path)))
		return undefined;
	if (path && is_git_recoverable(cwd, path)) return undefined;

	return {
		title: 'Confirm large content removal?',
		description: `This edit removes ${removed_chars - added_chars} more characters than it adds${path ? ` in ${path}` : ''}.`,
		reason: path
			? 'Removes substantial content from a file git cannot fully restore'
			: 'Removes substantial file content',
		allow_key: 'edit:large-removal-risky',
	};
}

function assess_custom_tool(
	event: ToolCallEvent,
): DestructiveAction | undefined {
	if (!DESTRUCTIVE_CUSTOM_TOOL_NAME.test(event.toolName))
		return undefined;

	const input = event.input as Record<string, unknown>;
	const query =
		typeof input.query === 'string'
			? `\n\nQuery: ${preview(input.query)}`
			: '';

	return {
		title: 'Confirm destructive tool call?',
		description: `Tool ${event.toolName} appears destructive.${query}`,
		reason: `Potentially destructive tool: ${event.toolName}`,
		allow_key: `tool:${event.toolName}`,
	};
}

export function assess_tool_call(
	event: ToolCallEvent,
	cwd: string,
	session_created_paths: ReadonlySet<string> = new Set(),
): DestructiveAction | undefined {
	if (event.toolName === 'bash') {
		const command = (event.input as { command?: unknown }).command;
		return typeof command === 'string'
			? assess_bash_command(command, cwd, session_created_paths)
			: undefined;
	}
	if (event.toolName === 'write') {
		return assess_file_write(
			cwd,
			event.input.path,
			session_created_paths,
		);
	}
	if (event.toolName === 'edit') {
		return assess_file_edit(cwd, event.input, session_created_paths);
	}
	return assess_custom_tool(event);
}
