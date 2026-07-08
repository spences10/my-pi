import { resolve } from 'node:path';
import {
	BUILTIN_EXTENSIONS,
	type BuiltinExtensionOptionName,
} from './extensions/builtin-registry.js';

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

export type BuiltinDisableCliArgs = Record<
	string,
	{
		type: 'boolean';
		description: string;
		default: false;
	}
>;

export function create_builtin_disable_cli_args(): BuiltinDisableCliArgs {
	return Object.fromEntries(
		BUILTIN_EXTENSIONS.map((extension) => [
			extension.cli_arg,
			{
				type: 'boolean' as const,
				description: extension.cli_description,
				default: false as const,
			},
		]),
	);
}

function is_citty_no_flag_set(
	args: Record<string, unknown>,
	cli_arg: string,
): boolean {
	if (args[cli_arg]) return true;

	const positive_kebab = cli_arg.replace(/^no-/, '');
	const positive_camel = positive_kebab.replace(
		/-([a-z])/g,
		(_, char) => String(char).toUpperCase(),
	);
	return (
		args[positive_kebab] === false || args[positive_camel] === false
	);
}

export function resolve_builtin_extension_options(
	args: Record<string, unknown>,
): Partial<Record<BuiltinExtensionOptionName, boolean>> {
	const no_builtin = is_citty_no_flag_set(args, 'no-builtin');
	return Object.fromEntries(
		BUILTIN_EXTENSIONS.map((extension) => [
			extension.option_name,
			!no_builtin && !is_citty_no_flag_set(args, extension.cli_arg),
		]),
	) as Partial<Record<BuiltinExtensionOptionName, boolean>>;
}

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

function parse_comma_list_flags(
	argv: string[],
	flags: readonly string[],
): string[] | undefined {
	const values = collect_flag_values(argv, flags)
		.flatMap((value) => value.split(','))
		.map((value) => value.trim())
		.filter(Boolean);
	return values.length ? [...new Set(values)] : undefined;
}

export function parse_tool_allowlist(
	argv: string[],
): string[] | undefined {
	return parse_comma_list_flags(argv, ['--tools', '-t']);
}

export function parse_tool_excludelist(
	argv: string[],
): string[] | undefined {
	return parse_comma_list_flags(argv, ['--exclude-tools', '-xt']);
}

export function parse_skill_allowlist(
	argv: string[],
): string[] | undefined {
	return parse_comma_list_flags(argv, ['--skill']);
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
