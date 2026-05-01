import { resolve } from 'node:path';

const THINKING_LEVELS = new Set([
	'off',
	'minimal',
	'low',
	'medium',
	'high',
	'xhigh',
]);

export type CliThinkingLevel =
	| 'off'
	| 'minimal'
	| 'low'
	| 'medium'
	| 'high'
	| 'xhigh';

export function collect_flag_values(
	argv: string[],
	flags: readonly string[],
): string[] {
	const values: string[] = [];
	const flag_set = new Set(flags);

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (!arg) continue;

		const equals_index = arg.indexOf('=');
		if (equals_index !== -1) {
			const name = arg.slice(0, equals_index);
			if (flag_set.has(name)) {
				values.push(arg.slice(equals_index + 1));
			}
			continue;
		}

		if (flag_set.has(arg) && i + 1 < argv.length) {
			const next = argv[i + 1];
			if (next !== undefined) {
				values.push(next);
				i += 1;
			}
		}
	}

	return values;
}

export function parse_extension_paths(
	argv: string[],
	cwd = process.cwd(),
): string[] {
	return collect_flag_values(argv, ['-e', '--extension'])
		.map((path) => path.trim())
		.filter(Boolean)
		.map((path) => resolve(cwd, path));
}

export function parse_tool_allowlist(
	argv: string[],
): string[] | undefined {
	const tools = collect_flag_values(argv, ['--tools', '-t'])
		.flatMap((value) => value.split(','))
		.map((tool) => tool.trim())
		.filter(Boolean);
	return tools.length ? [...new Set(tools)] : undefined;
}

export function parse_skill_allowlist(
	argv: string[],
): string[] | undefined {
	const skills = collect_flag_values(argv, ['--skill'])
		.flatMap((value) => value.split(','))
		.map((skill) => skill.trim())
		.filter(Boolean);
	return skills.length ? [...new Set(skills)] : undefined;
}

export function parse_thinking_level(
	value: string | undefined,
): CliThinkingLevel | undefined {
	const normalized = value?.trim().toLowerCase();
	if (!normalized) return undefined;
	if (!THINKING_LEVELS.has(normalized)) {
		throw new Error(
			'--thinking must be one of: off, minimal, low, medium, high, xhigh.',
		);
	}
	return normalized as CliThinkingLevel;
}
