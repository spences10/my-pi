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

export interface CliArgDefinition {
	type: 'boolean' | 'string' | 'enum' | 'positional';
	alias?: string | readonly string[];
}

export type CliArgDefinitions = Record<string, CliArgDefinition>;

export interface ParsedExtensionCliArgs {
	extension_flag_values: Map<string, boolean | string>;
	positionals: string[];
	diagnostics: string[];
}

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

export function parse_extension_cli_args(
	argv: string[],
	known_args: CliArgDefinitions,
): ParsedExtensionCliArgs {
	const known_flags = new Map<string, CliArgDefinition['type']>();
	for (const [name, definition] of Object.entries(known_args)) {
		known_flags.set(`--${name}`, definition.type);
		const camel_name = name.replace(/-([a-z])/g, (_, char) =>
			String(char).toUpperCase(),
		);
		known_flags.set(`--${camel_name}`, definition.type);
		if (definition.type === 'boolean')
			known_flags.set(`--no-${name}`, definition.type);
		const aliases = Array.isArray(definition.alias)
			? definition.alias
			: definition.alias
				? [definition.alias]
				: [];
		for (const alias of aliases)
			known_flags.set(`-${alias}`, definition.type);
	}

	const extension_flag_values = new Map<string, boolean | string>();
	const positionals: string[] = [];
	const diagnostics: string[] = [];

	for (let i = 0; i < argv.length; i++) {
		const arg = argv[i];
		if (!arg) continue;
		if (arg === '--') {
			positionals.push(...argv.slice(i + 1));
			break;
		}

		const equals_index = arg.indexOf('=');
		const flag_token =
			equals_index === -1 ? arg : arg.slice(0, equals_index);
		const known_type = known_flags.get(flag_token);
		if (known_type) {
			if (
				equals_index === -1 &&
				(known_type === 'string' || known_type === 'enum') &&
				i + 1 < argv.length
			) {
				i += 1;
			}
			continue;
		}

		if (arg.startsWith('--')) {
			if (equals_index !== -1) {
				extension_flag_values.set(
					arg.slice(2, equals_index),
					arg.slice(equals_index + 1),
				);
				continue;
			}
			const name = arg.slice(2);
			const next = argv[i + 1];
			if (
				next !== undefined &&
				!next.startsWith('-') &&
				!next.startsWith('@')
			) {
				extension_flag_values.set(name, next);
				i += 1;
			} else {
				extension_flag_values.set(name, true);
			}
			continue;
		}

		if (arg.startsWith('-')) {
			diagnostics.push(`Unknown option: ${arg}`);
			continue;
		}
		positionals.push(arg);
	}

	return { extension_flag_values, positionals, diagnostics };
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
