import type { ToolCallEvent } from '@earendil-works/pi-coding-agent';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import {
	get_git_recoverability,
	git,
	is_git_recoverable,
} from './git.js';
import { describe_path_risk, is_agent_temp_path } from './paths.js';
import { extract_command_paths } from './shell.js';
import type {
	DestructiveAction,
	DestructiveCommandPattern,
} from './types.js';

const DESTRUCTIVE_COMMAND_PATTERNS: DestructiveCommandPattern[] = [
	{
		pattern:
			/(^|[;&|]\s*)(npx\s+|pnpx\s+|pnpm\s+exec\s+|bunx\s+)?prisma\s+(migrate\s+reset|db\s+push\b[^;&|]*--force-reset|db\s+execute\b)/,
		reason:
			'Runs a potentially destructive Prisma database operation',
		allow_key: 'bash:prisma-destructive',
	},
	{
		pattern:
			/(^|[;&|]\s*)(psql|mysql|mariadb|sqlite3)\b[^;&|]*\b(drop|delete\s+from|truncate|alter\s+table|update\s+\S+\s+set)\b/i,
		reason: 'Runs destructive SQL through a database CLI',
		allow_key: 'bash:db-cli-destructive-sql',
	},
	{
		pattern:
			/(^|[;&|]\s*)find\b[^;&|]*(\s-delete\b|-exec\s+(sudo\s+)?rm\b)/,
		reason: 'Deletes files found by find',
		allow_key: 'bash:find-delete',
	},
	{
		pattern:
			/(^|[;&|]\s*)git\s+clean\b[^;&|]*-[a-zA-Z]*[fdx][a-zA-Z]*/,
		reason: 'Deletes untracked files or directories',
		allow_key: 'bash:git-clean',
	},
	{
		pattern:
			/(^|[;&|]\s*)git\s+(checkout|restore)\b[^;&|]*(\s--\s+\.\s*$|\s\.\s*$)/,
		reason: 'Discards working tree changes',
		allow_key: 'bash:git-discard-all',
	},
	{
		pattern: /(^|[;&|]\s*)rsync\b[^;&|]*\s--delete\b/,
		reason: 'Deletes destination files during sync',
		allow_key: 'bash:rsync-delete',
	},
	{
		pattern:
			/(^|[;&|]\s*)truncate\b[^;&|]*(\s-s\s*0\b|\s--size\s*=?\s*0\b)/,
		reason: 'Empties file contents',
		allow_key: 'bash:truncate-zero',
	},
	{
		pattern: /(^|[;&|]\s*)dd\b[^;&|]*\bof=/,
		reason: 'Overwrites a device or file with dd',
		allow_key: 'bash:dd-output',
	},
	{
		pattern: /(^|[;&|]\s*)(mkfs|fdisk|parted|wipefs)\b/,
		reason: 'Modifies disks or filesystems',
		allow_key: 'bash:disk-tool',
	},
];

const DESTRUCTIVE_CUSTOM_TOOL_NAME =
	/(^|[_-])(delete|destroy|drop|remove|archive|execute_write_query|execute_schema_query|bulk_insert)([_-]|$)/i;

function preview(value: string, max = 500): string {
	const normalized = value.trim().replace(/\s+/g, ' ');
	return normalized.length > max
		? `${normalized.slice(0, max - 1)}…`
		: normalized;
}

function assess_rm_command(
	command: string,
	cwd: string,
	session_created_paths: ReadonlySet<string> = new Set(),
): DestructiveAction | undefined {
	if (
		!/(^|[;&|]\s*)(sudo\s+)?(rm|rmdir|unlink|shred)\b/.test(command)
	) {
		return undefined;
	}

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
	return {
		title: 'Confirm destructive command?',
		description: `${reason}: ${preview(command)}`,
		reason,
		allow_key: 'bash:rm-risky',
	};
}

function assess_git_rm_command(
	command: string,
	cwd: string,
): DestructiveAction | undefined {
	if (!/(^|[;&|]\s*)git\s+rm\b/.test(command)) return undefined;
	if (/\s-f\b|\s--force\b/.test(command)) {
		return {
			title: 'Confirm forced git removal?',
			description: `Forced git removal can discard uncommitted file changes: ${preview(command)}`,
			reason: 'Force-removes files from git',
			allow_key: 'bash:git-rm-force',
		};
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
	return {
		title: 'Confirm git removal?',
		description: `${reason}: ${preview(command)}`,
		reason,
		allow_key: 'bash:git-rm-risky',
	};
}

function assess_git_reset_hard(
	command: string,
	cwd: string,
): DestructiveAction | undefined {
	if (!/(^|[;&|]\s*)git\s+reset\b[^;&|]*--hard\b/.test(command)) {
		return undefined;
	}
	if (git(['status', '--porcelain=v1'], cwd) === '') return undefined;

	return {
		title: 'Confirm hard reset?',
		description: `This can discard uncommitted tracked changes: ${preview(command)}`,
		reason: 'Discards uncommitted tracked changes',
		allow_key: 'bash:git-reset-hard',
	};
}

function assess_git_force_push(
	command: string,
): DestructiveAction | undefined {
	if (
		!/(^|[;&|]\s*)git\s+push\b[^;&|]*(\s--force(?:-with-lease|-if-includes)?\b|\s-[A-Za-z]*f[A-Za-z]*\b)/.test(
			command,
		)
	) {
		return undefined;
	}

	return {
		title: 'Confirm force push?',
		description: `This can overwrite remote git history: ${preview(command)}`,
		reason: 'Overwrites remote git history',
		allow_key: 'bash:git-force-push',
	};
}

export function assess_bash_command(
	command: string,
	cwd = process.cwd(),
	session_created_paths: ReadonlySet<string> = new Set(),
): DestructiveAction | undefined {
	const normalized = command.trim();
	if (!normalized) return undefined;

	const specific =
		assess_rm_command(normalized, cwd, session_created_paths) ??
		assess_git_rm_command(normalized, cwd) ??
		assess_git_reset_hard(normalized, cwd) ??
		assess_git_force_push(normalized);
	if (specific) return specific;

	const match = DESTRUCTIVE_COMMAND_PATTERNS.find(({ pattern }) =>
		pattern.test(normalized),
	);
	if (!match) return undefined;

	return {
		title: 'Confirm destructive command?',
		description: `${match.reason}: ${preview(normalized)}`,
		reason: match.reason,
		allow_key: match.allow_key,
	};
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

	if (removed_chars === 0 || removed_chars - added_chars < 200) {
		return undefined;
	}
	if (path && session_created_paths.has(resolve(cwd, path))) {
		return undefined;
	}
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
	if (!DESTRUCTIVE_CUSTOM_TOOL_NAME.test(event.toolName)) {
		return undefined;
	}

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
