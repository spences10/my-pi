import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export type BuiltinExtensionKey =
	| 'mcp'
	| 'skills'
	| 'filter-output'
	| 'recall'
	| 'nopeek'
	| 'omnisearch'
	| 'sqlite-tools'
	| 'prompt-presets'
	| 'lsp'
	| 'session-name'
	| 'confirm-destructive'
	| 'hooks-resolution';

export interface BuiltinExtensionInfo {
	key: BuiltinExtensionKey;
	label: string;
	description: string;
	cli_flag: string;
	aliases: string[];
}

export interface BuiltinExtensionsConfig {
	version: number;
	enabled: Partial<Record<BuiltinExtensionKey, boolean>>;
}

export interface BuiltinExtensionState extends BuiltinExtensionInfo {
	saved_enabled: boolean;
	effective_enabled: boolean;
	forced_disabled: boolean;
}

const DEFAULT_CONFIG: BuiltinExtensionsConfig = {
	version: 1,
	enabled: {},
};

export const BUILTIN_EXTENSIONS: BuiltinExtensionInfo[] = [
	{
		key: 'mcp',
		label: 'MCP',
		description: 'MCP server integration and /mcp command',
		cli_flag: '--no-mcp',
		aliases: ['mcp'],
	},
	{
		key: 'skills',
		label: 'Skills',
		description: 'Managed pi-native skills and /skills command',
		cli_flag: '--no-skills',
		aliases: ['skills', 'skill'],
	},
	{
		key: 'filter-output',
		label: 'Filter output',
		description: 'Secret redaction for tool output',
		cli_flag: '--no-filter',
		aliases: [
			'filter-output',
			'filter_output',
			'filter',
			'redaction',
		],
	},
	{
		key: 'recall',
		label: 'Recall',
		description: 'pirecall reminder and background session sync',
		cli_flag: '--no-recall',
		aliases: ['recall', 'pirecall'],
	},
	{
		key: 'nopeek',
		label: 'Nopeek',
		description:
			'nopeek reminder for secret-safe environment loading',
		cli_flag: '--no-nopeek',
		aliases: ['nopeek', 'secrets', 'secret-loading'],
	},
	{
		key: 'omnisearch',
		label: 'Omnisearch',
		description: 'mcp-omnisearch reminder for verified web research',
		cli_flag: '--no-omnisearch',
		aliases: ['omnisearch', 'search', 'web-search', 'research'],
	},
	{
		key: 'sqlite-tools',
		label: 'SQLite tools',
		description:
			'mcp-sqlite-tools reminder for safer SQLite database work',
		cli_flag: '--no-sqlite-tools',
		aliases: ['sqlite-tools', 'sqlite', 'mcp-sqlite-tools'],
	},
	{
		key: 'prompt-presets',
		label: 'Prompt presets',
		description:
			'Runtime prompt preset selection and /prompt-preset command',
		cli_flag: '--no-prompt-presets',
		aliases: ['prompt-presets', 'prompt-preset', 'preset', 'presets'],
	},
	{
		key: 'lsp',
		label: 'LSP',
		description:
			'Language Server Protocol tools (diagnostics, hover, definition, references)',
		cli_flag: '--no-lsp',
		aliases: ['lsp', 'language-server'],
	},
	{
		key: 'session-name',
		label: 'Session name',
		description:
			'AI-powered session auto-naming and /session-name command',
		cli_flag: '--no-session-name',
		aliases: ['session-name', 'session', 'auto-name'],
	},
	{
		key: 'confirm-destructive',
		label: 'Confirm destructive',
		description:
			'Prompt before destructive tool calls like file deletes, overwrites, and hard resets',
		cli_flag: '--no-confirm-destructive',
		aliases: ['confirm-destructive', 'confirm'],
	},
	{
		key: 'hooks-resolution',
		label: 'Hooks resolution',
		description:
			'Claude Code style PostToolUse hook compatibility from .claude, .rulesync, and .pi configs',
		cli_flag: '--no-hooks',
		aliases: ['hooks-resolution', 'hooks'],
	},
];

export function get_builtin_extensions_config_path(): string {
	const xdg =
		process.env.XDG_CONFIG_HOME || join(homedir(), '.config');
	return join(xdg, 'my-pi', 'extensions.json');
}

export function load_builtin_extensions_config(): BuiltinExtensionsConfig {
	const path = get_builtin_extensions_config_path();
	if (!existsSync(path)) return { ...DEFAULT_CONFIG };

	try {
		const raw = readFileSync(path, 'utf-8');
		const parsed = JSON.parse(
			raw,
		) as Partial<BuiltinExtensionsConfig>;
		const enabled: BuiltinExtensionsConfig['enabled'] = {};
		for (const extension of BUILTIN_EXTENSIONS) {
			const value = parsed.enabled?.[extension.key];
			if (typeof value === 'boolean') {
				enabled[extension.key] = value;
			}
		}

		return {
			version: parsed.version ?? 1,
			enabled,
		};
	} catch {
		return { ...DEFAULT_CONFIG };
	}
}

export function save_builtin_extensions_config(
	config: BuiltinExtensionsConfig,
): void {
	const path = get_builtin_extensions_config_path();
	const dir = dirname(path);
	if (!existsSync(dir)) {
		mkdirSync(dir, { recursive: true, mode: 0o700 });
	}

	const tmp = `${path}.tmp-${Date.now()}`;
	writeFileSync(tmp, JSON.stringify(config, null, '\t') + '\n', {
		mode: 0o600,
	});
	renameSync(tmp, path);
}

export function is_builtin_extension_enabled(
	config: BuiltinExtensionsConfig,
	key: BuiltinExtensionKey,
): boolean {
	return config.enabled[key] ?? true;
}

export function is_builtin_extension_active(
	config: BuiltinExtensionsConfig,
	key: BuiltinExtensionKey,
	force_disabled: ReadonlySet<BuiltinExtensionKey> = new Set(),
): boolean {
	return (
		is_builtin_extension_enabled(config, key) &&
		!force_disabled.has(key)
	);
}

export function resolve_builtin_extension_states(
	force_disabled: ReadonlySet<BuiltinExtensionKey> = new Set(),
	config: BuiltinExtensionsConfig = load_builtin_extensions_config(),
): BuiltinExtensionState[] {
	return BUILTIN_EXTENSIONS.map((extension) => {
		const saved_enabled = is_builtin_extension_enabled(
			config,
			extension.key,
		);
		const forced = force_disabled.has(extension.key);
		return {
			...extension,
			saved_enabled,
			effective_enabled: saved_enabled && !forced,
			forced_disabled: forced,
		};
	});
}

export function find_builtin_extension(
	query: string,
): BuiltinExtensionInfo | undefined {
	const normalized = query.trim().toLowerCase();
	if (!normalized) return undefined;

	return BUILTIN_EXTENSIONS.find((extension) =>
		[extension.key, extension.label, ...extension.aliases].some(
			(value) => value.toLowerCase() === normalized,
		),
	);
}
