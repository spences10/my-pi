import type { ExtensionFactory } from '@mariozechner/pi-coding-agent';

export type BuiltinExtensionRuntimeMode =
	| 'interactive'
	| 'print'
	| 'json'
	| 'rpc';

type BuiltinExtensionLoader = () => Promise<ExtensionFactory>;

export interface BuiltinExtensionManifestEntry {
	key: string;
	label: string;
	docs_label: string;
	description: string;
	default_enabled: boolean;
	option_name: string;
	cli_arg: string;
	cli_flag: `--${string}`;
	cli_description: string;
	aliases: readonly string[];
	mode_constraints?: {
		disabled_in: readonly BuiltinExtensionRuntimeMode[];
		reason: string;
	};
	load: BuiltinExtensionLoader;
}

export const BUILTIN_EXTENSION_REGISTRY = [
	{
		key: 'context-sidecar',
		label: 'Context sidecar',
		docs_label: 'SQLite context sidecar',
		description: 'Local SQLite FTS sidecar for oversized tool output',
		default_enabled: true,
		option_name: 'context_sidecar',
		cli_arg: 'no-context-sidecar',
		cli_flag: '--no-context-sidecar',
		cli_description:
			'Disable SQLite context sidecar for large tool output',
		aliases: ['context-sidecar', 'context', 'sidecar'],
		load: async () => (await import('@spences10/pi-context')).default,
	},
	{
		key: 'mcp',
		label: 'MCP',
		docs_label: 'MCP',
		description: 'MCP server integration and /mcp command',
		default_enabled: true,
		option_name: 'mcp',
		cli_arg: 'no-mcp',
		cli_flag: '--no-mcp',
		cli_description: 'Disable built-in MCP extension',
		aliases: ['mcp'],
		load: async () => (await import('@spences10/pi-mcp')).default,
	},
	{
		key: 'skills',
		label: 'Skills',
		docs_label: 'Skills',
		description: 'Managed pi-native skills and /skills command',
		default_enabled: true,
		option_name: 'skills',
		cli_arg: 'no-skills',
		cli_flag: '--no-skills',
		cli_description: 'Disable built-in skills extension',
		aliases: ['skills', 'skill'],
		load: async () => (await import('@spences10/pi-skills')).default,
	},
	{
		key: 'filter-output',
		label: 'Filter output',
		docs_label: 'Output filtering',
		description: 'Secret redaction for tool output',
		default_enabled: true,
		option_name: 'filter_output',
		cli_arg: 'no-filter',
		cli_flag: '--no-filter',
		cli_description: 'Disable secret redaction in tool output',
		aliases: [
			'filter-output',
			'filter_output',
			'filter',
			'redaction',
		],
		load: async () => (await import('@spences10/pi-redact')).default,
	},
	{
		key: 'recall',
		label: 'Recall',
		docs_label: 'Recall',
		description: 'pirecall reminder and background session sync',
		default_enabled: true,
		option_name: 'recall',
		cli_arg: 'no-recall',
		cli_flag: '--no-recall',
		cli_description: 'Disable recall extension',
		aliases: ['recall', 'pirecall'],
		load: async () => (await import('@spences10/pi-recall')).default,
	},
	{
		key: 'nopeek',
		label: 'Nopeek',
		docs_label: 'Nopeek',
		description:
			'nopeek reminder for secret-safe environment loading',
		default_enabled: true,
		option_name: 'nopeek',
		cli_arg: 'no-nopeek',
		cli_flag: '--no-nopeek',
		cli_description: 'Disable nopeek reminder extension',
		aliases: ['nopeek', 'secrets', 'secret-loading'],
		load: async () => (await import('@spences10/pi-nopeek')).default,
	},
	{
		key: 'omnisearch',
		label: 'Omnisearch',
		docs_label: 'Omnisearch',
		description: 'mcp-omnisearch reminder for verified web research',
		default_enabled: true,
		option_name: 'omnisearch',
		cli_arg: 'no-omnisearch',
		cli_flag: '--no-omnisearch',
		cli_description: 'Disable mcp-omnisearch reminder extension',
		aliases: ['omnisearch', 'search', 'web-search', 'research'],
		load: async () =>
			(await import('@spences10/pi-omnisearch')).default,
	},
	{
		key: 'sqlite-tools',
		label: 'SQLite tools',
		docs_label: 'SQLite tools',
		description:
			'mcp-sqlite-tools reminder for safer SQLite database work',
		default_enabled: true,
		option_name: 'sqlite_tools',
		cli_arg: 'no-sqlite-tools',
		cli_flag: '--no-sqlite-tools',
		cli_description: 'Disable mcp-sqlite-tools reminder extension',
		aliases: ['sqlite-tools', 'sqlite', 'mcp-sqlite-tools'],
		load: async () =>
			(await import('@spences10/pi-sqlite-tools')).default,
	},
	{
		key: 'prompt-presets',
		label: 'Prompt presets',
		docs_label: 'Prompt presets',
		description:
			'Runtime prompt preset selection and /prompt-preset command',
		default_enabled: true,
		option_name: 'prompt_presets',
		cli_arg: 'no-prompt-presets',
		cli_flag: '--no-prompt-presets',
		cli_description: 'Disable prompt presets extension',
		aliases: ['prompt-presets', 'prompt-preset', 'preset', 'presets'],
		load: async () =>
			(await import('./prompt-presets/index.js')).default,
	},
	{
		key: 'lsp',
		label: 'LSP',
		docs_label: 'LSP',
		description:
			'Language Server Protocol tools (diagnostics, hover, definition, references)',
		default_enabled: true,
		option_name: 'lsp',
		cli_arg: 'no-lsp',
		cli_flag: '--no-lsp',
		cli_description: 'Disable LSP extension',
		aliases: ['lsp', 'language-server'],
		load: async () => (await import('@spences10/pi-lsp')).default,
	},
	{
		key: 'session-name',
		label: 'Session name',
		docs_label: 'Session auto-naming',
		description:
			'AI-powered session auto-naming and /session-name command',
		default_enabled: true,
		option_name: 'session_name',
		cli_arg: 'no-session-name',
		cli_flag: '--no-session-name',
		cli_description: 'Disable session name extension',
		aliases: ['session-name', 'session', 'auto-name'],
		mode_constraints: {
			disabled_in: ['print', 'json', 'rpc'],
			reason:
				'UI-only session naming is only useful in interactive mode',
		},
		load: async () =>
			(await import('./session-name/index.js')).default,
	},
	{
		key: 'confirm-destructive',
		label: 'Confirm destructive',
		docs_label: 'Destructive action confirmation',
		description:
			'Prompt before destructive tool calls like file deletes, overwrites, and hard resets',
		default_enabled: true,
		option_name: 'confirm_destructive',
		cli_arg: 'no-confirm-destructive',
		cli_flag: '--no-confirm-destructive',
		cli_description: 'Disable destructive action confirmations',
		aliases: ['confirm-destructive', 'confirm'],
		load: async () =>
			(await import('@spences10/pi-confirm-destructive')).default,
	},
	{
		key: 'hooks-resolution',
		label: 'Hooks resolution',
		docs_label: 'Hooks resolution',
		description:
			'Claude Code style PostToolUse hook compatibility from .claude, .rulesync, and .pi configs',
		default_enabled: true,
		option_name: 'hooks_resolution',
		cli_arg: 'no-hooks',
		cli_flag: '--no-hooks',
		cli_description: 'Disable Claude-style hook execution',
		aliases: ['hooks-resolution', 'hooks'],
		load: async () =>
			(await import('./hooks-resolution/index.js')).default,
	},
	{
		key: 'team-mode',
		label: 'Team mode',
		docs_label: 'Team mode',
		description:
			'Experimental orchestrator/team mode with RPC teammates, tasks, and mailboxes',
		default_enabled: true,
		option_name: 'team_mode',
		cli_arg: 'no-team-mode',
		cli_flag: '--no-team-mode',
		cli_description: 'Disable experimental team mode extension',
		aliases: ['team-mode', 'team', 'teammates'],
		load: async () =>
			(await import('@spences10/pi-team-mode')).default,
	},
] as const satisfies readonly BuiltinExtensionManifestEntry[];

export type BuiltinExtensionKey =
	(typeof BUILTIN_EXTENSION_REGISTRY)[number]['key'];

export type BuiltinExtensionOptionName =
	(typeof BUILTIN_EXTENSION_REGISTRY)[number]['option_name'];

export type BuiltinExtensionInfo = Omit<
	BuiltinExtensionManifestEntry,
	'load'
> & {
	key: BuiltinExtensionKey;
	option_name: BuiltinExtensionOptionName;
};

export const BUILTIN_EXTENSIONS: BuiltinExtensionInfo[] =
	BUILTIN_EXTENSION_REGISTRY.map(
		({ load: _load, ...extension }) => extension,
	);
