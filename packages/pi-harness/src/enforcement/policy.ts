import {
	isAbsolute,
	matchesGlob,
	relative,
	resolve,
} from 'node:path';
import type { HarnessContract } from '../schema.js';

export function pattern_matches(
	cwd: string,
	pattern: string,
	path: string,
): boolean {
	const normalized = (
		isAbsolute(pattern) ? relative(cwd, pattern) : pattern
	).replaceAll('\\', '/');
	const candidate = relative(cwd, resolve(cwd, path)).replaceAll(
		'\\',
		'/',
	);
	if (normalized === '.') return true;
	if (!/[*?[{]/.test(normalized)) {
		return (
			candidate === normalized ||
			candidate.startsWith(`${normalized}/`)
		);
	}
	return matchesGlob(candidate, normalized);
}

export function check_path_allowed(
	contract: HarnessContract,
	input_path: string,
): { ok: true } | { ok: false; reason: string } {
	const cwd = resolve(contract.policy.cwd);
	const absolute_path = resolve(cwd, input_path);
	let reason: string | undefined;
	if (absolute_path !== cwd && !absolute_path.startsWith(`${cwd}/`)) {
		reason = 'path is outside cwd';
	} else if (
		contract.policy.forbidden_paths.some((pattern) =>
			pattern_matches(cwd, pattern, input_path),
		)
	) {
		reason = 'path is forbidden';
	} else if (
		(!contract.scaffold.allow_test_changes ||
			contract.policy.allow_test_changes === false) &&
		(/(^|\/)(__tests__|tests?)\//.test(input_path) ||
			/\.(test|spec)\.[cm]?[jt]sx?$/.test(input_path))
	) {
		reason = 'test changes are not allowed by harness.json';
	} else if (
		!contract.scaffold.allowed_paths.some((pattern) =>
			pattern_matches(cwd, pattern, input_path),
		) ||
		!(
			contract.policy.allowed_paths ?? contract.scaffold.allowed_paths
		).some((pattern) => pattern_matches(cwd, pattern, input_path))
	) {
		reason = 'path is outside allowed_paths';
	}
	return reason
		? {
				ok: false,
				reason: `Harness ${contract.id}: ${reason}: ${input_path}`,
			}
		: { ok: true };
}

export function check_command_allowed(
	contract: HarnessContract,
	command: string,
): { ok: true } | { ok: false; reason: string } {
	const blocked = contract.policy.forbidden_commands.find((needle) =>
		command.includes(needle),
	);
	return blocked
		? {
				ok: false,
				reason: `Harness ${contract.id}: command contains forbidden pattern: ${blocked}`,
			}
		: { ok: true };
}

export function build_path_helpers(): string {
	return String.raw`
function pattern_matches(pattern, path) {
  const normalized = (isAbsolute(pattern) ? relative(cwd, pattern) : pattern).replaceAll('\\', '/');
  const candidate = relative(cwd, resolve(cwd, path)).replaceAll('\\', '/');
  if (normalized === '.') return true;
  if (!/[*?[{]/.test(normalized)) return candidate === normalized || candidate.startsWith(normalized + '/');
  return matchesGlob(candidate, normalized);
}
`;
}
