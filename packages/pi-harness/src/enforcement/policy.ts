import { isAbsolute, relative, resolve } from 'node:path';
import type { HarnessContract } from '../schema.js';

function resolve_project_path(
	cwd: string,
	input_path: string,
): string {
	return resolve(cwd, input_path);
}

function pattern_to_relative(cwd: string, pattern: string): string {
	const normalized_pattern = pattern.replaceAll('\\', '/');
	if (!isAbsolute(pattern)) return normalized_pattern;
	return relative(cwd, resolve(pattern)).replaceAll('\\', '/');
}

function pattern_matches(
	cwd: string,
	pattern: string,
	absolute_path: string,
): boolean {
	const normalized_pattern = pattern_to_relative(cwd, pattern);
	const relative_path = relative(cwd, absolute_path).replaceAll(
		'\\',
		'/',
	);
	if (normalized_pattern === '.') return true;
	if (normalized_pattern.endsWith('/**')) {
		const prefix = normalized_pattern.slice(0, -3);
		return (
			relative_path === prefix ||
			relative_path.startsWith(`${prefix}/`)
		);
	}
	if (normalized_pattern.includes('*')) {
		const regex = new RegExp(
			`^${normalized_pattern
				.replace(/[.+?^${}()|[\]\\]/g, '\\$&')
				.replaceAll('**', '.*')
				.replaceAll('*', '[^/]*')}$`,
		);
		return regex.test(relative_path);
	}
	const target = isAbsolute(pattern)
		? resolve(pattern)
		: resolve_project_path(cwd, pattern);
	return (
		absolute_path === target || absolute_path.startsWith(`${target}/`)
	);
}

function is_test_path(absolute_path: string): boolean {
	const path = absolute_path.replaceAll('\\', '/');
	return (
		/(^|\/)(__tests__|tests?)\//.test(path) ||
		/\.(test|spec)\.[cm]?[jt]sx?$/.test(path)
	);
}

export function check_path_allowed(
	contract: HarnessContract,
	input_path: string,
): { ok: true } | { ok: false; reason: string } {
	const cwd = resolve(contract.cwd);
	const absolute_path = resolve_project_path(cwd, input_path);
	const inside_cwd =
		absolute_path === cwd || absolute_path.startsWith(`${cwd}/`);
	if (!inside_cwd) {
		return {
			ok: false,
			reason: `Harness ${contract.id}: path is outside cwd: ${input_path}`,
		};
	}
	if (
		contract.forbidden_paths.some((pattern) =>
			pattern_matches(cwd, pattern, absolute_path),
		)
	) {
		return {
			ok: false,
			reason: `Harness ${contract.id}: path is forbidden: ${input_path}`,
		};
	}
	if (!contract.allow_test_changes && is_test_path(absolute_path)) {
		return {
			ok: false,
			reason: `Harness ${contract.id}: test changes are not allowed by harness.json`,
		};
	}
	if (
		!contract.allowed_paths.some((pattern) =>
			pattern_matches(cwd, pattern, absolute_path),
		)
	) {
		return {
			ok: false,
			reason: `Harness ${contract.id}: path is outside allowed_paths: ${input_path}`,
		};
	}
	return { ok: true };
}

export function check_command_allowed(
	contract: HarnessContract,
	command: string,
): { ok: true } | { ok: false; reason: string } {
	const blocked = contract.forbidden_commands.find((needle) =>
		command.includes(needle),
	);
	if (blocked) {
		return {
			ok: false,
			reason: `Harness ${contract.id}: command contains forbidden pattern: ${blocked}`,
		};
	}
	if (
		!contract.allow_test_changes &&
		/\brm\b.*((^|\/)(__tests__|tests?)\/|\.(test|spec)\.)/.test(
			command,
		)
	) {
		return {
			ok: false,
			reason: `Harness ${contract.id}: deleting tests is not allowed`,
		};
	}
	return { ok: true };
}
