import type { ExtensionFactory } from '@earendil-works/pi-coding-agent';

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
	external_package_name?: string;
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
		external_package_name: '@spences10/pi-context',
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
		external_package_name: '@spences10/pi-mcp',
		load: async () => (await import('@spences10/pi-mcp')).default,
	},
	{
		key: 'openrouter-fusion-config',
		label: 'OpenRouter Fusion config',
		docs_label: 'OpenRouter Fusion config guard',
		description:
			'Keeps OpenRouter Fusion off Anthropic by injecting a non-Anthropic panel and judge',
		default_enabled: true,
		option_name: 'openrouter_fusion_config',
		cli_arg: 'no-openrouter-fusion-config',
		cli_flag: '--no-openrouter-fusion-config',
		cli_description: 'Disable OpenRouter Fusion non-Anthropic config',
		aliases: ['openrouter-fusion-config', 'fusion-budget'],
		load: async () =>
			(await import('./openrouter-fusion-config/index.js')).default,
	},
	{
		key: 'umans-provider',
		label: 'Umans provider',
		docs_label: 'Umans provider',
		description:
			'Umans.ai Anthropic Messages provider with API key login support',
		default_enabled: true,
		option_name: 'umans_provider',
		cli_arg: 'no-umans-provider',
		cli_flag: '--no-umans-provider',
		cli_description: 'Disable built-in Umans provider',
		aliases: ['umans-provider', 'umans'],
		load: async () =>
			(await import('./umans-provider/index.js')).default,
	},
	{
		key: 'footer',
		label: 'Footer',
		docs_label: 'Footer',
		description: 'Configurable interactive footer/statusline',
		default_enabled: true,
		option_name: 'footer',
		cli_arg: 'no-footer',
		cli_flag: '--no-footer',
		cli_description: 'Disable custom footer/statusline',
		aliases: ['footer', 'statusline', 'status-line'],
		mode_constraints: {
			disabled_in: ['print', 'json', 'rpc'],
			reason: 'Footer only renders in the interactive TUI',
		},
		load: async () => (await import('./footer/index.js')).default,
	},
	{
		key: 'codex-usage',
		label: 'Codex usage',
		docs_label: 'Codex usage status',
		description: 'OpenAI Codex usage status for the footer',
		default_enabled: true,
		option_name: 'codex_usage',
		cli_arg: 'no-codex-usage',
		cli_flag: '--no-codex-usage',
		cli_description: 'Disable Codex usage footer status',
		aliases: ['codex-usage', 'codex-status'],
		external_package_name: '@spences10/pi-codex-usage',
		load: async () =>
			(await import('@spences10/pi-codex-usage')).default,
	},
	{
		key: 'harness',
		label: 'Harness',
		docs_label: 'Task harness runtime',
		description:
			'Ephemeral /tmp task harness runtime with tools, enforcement, and bundled skills',
		default_enabled: true,
		option_name: 'harness',
		cli_arg: 'no-harness',
		cli_flag: '--no-harness',
		cli_description: 'Disable task harness runtime',
		aliases: ['harness', 'task-harness'],
		external_package_name: '@spences10/pi-harness',
		load: async () => (await import('@spences10/pi-harness')).default,
	},
	{
		key: 'factory',
		label: 'Software factory (experimental)',
		docs_label: 'Experimental software-factory control plane',
		description:
			'Paused experimental workflow control plane; enable explicitly for Factory v1 evaluation only',
		default_enabled: false,
		option_name: 'factory',
		cli_arg: 'no-factory',
		cli_flag: '--no-factory',
		cli_description: 'Disable software-factory control plane',
		aliases: ['factory', 'software-factory', 'control-plane'],
		external_package_name: '@spences10/pi-factory',
		load: async () => (await import('@spences10/pi-factory')).default,
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
		external_package_name: '@spences10/pi-skills',
		load: async () => (await import('@spences10/pi-skills')).default,
	},
	{
		key: 'skill-importer',
		label: 'Skill importer',
		docs_label: 'Skill importer',
		description:
			'Import external Claude/plugin skills into Pi-native storage',
		default_enabled: true,
		option_name: 'skill_importer',
		cli_arg: 'no-skill-importer',
		cli_flag: '--no-skill-importer',
		cli_description: 'Disable external skill importer extension',
		aliases: ['skill-importer', 'import-skills', 'skill-import'],
		external_package_name: '@spences10/pi-skill-importer',
		load: async () =>
			(await import('@spences10/pi-skill-importer')).default,
	},
	{
		key: 'filter-output',
		label: 'Secret redaction',
		docs_label: 'Secret redaction',
		description:
			'Redacts secrets from tool output before the model sees them',
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
			'secret-redaction',
			'output-redaction',
		],
		external_package_name: '@spences10/pi-redact',
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
		external_package_name: '@spences10/pi-recall',
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
		external_package_name: '@spences10/pi-nopeek',
		load: async () => (await import('@spences10/pi-nopeek')).default,
	},
	{
		key: 'observability',
		label: 'Observability',
		docs_label: 'Live observability',
		description:
			'Optional live event stream and local browser dashboard',
		default_enabled: true,
		option_name: 'observability',
		cli_arg: 'no-observability',
		cli_flag: '--no-observability',
		cli_description: 'Disable live observability extension',
		aliases: ['observability', 'obs', 'live-events'],
		external_package_name: '@spences10/pi-observability',
		load: async () =>
			(await import('@spences10/pi-observability')).default,
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
		external_package_name: '@spences10/pi-omnisearch',
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
		external_package_name: '@spences10/pi-sqlite-tools',
		load: async () =>
			(await import('@spences10/pi-sqlite-tools')).default,
	},
	{
		key: 'startup-screen',
		label: 'Startup screen',
		docs_label: 'Startup screen',
		description:
			'Pixel-art gradient startup header for interactive sessions',
		default_enabled: true,
		option_name: 'startup_screen',
		cli_arg: 'no-startup-screen',
		cli_flag: '--no-startup-screen',
		cli_description: 'Disable the custom startup screen',
		aliases: ['startup-screen', 'startup', 'header', 'splash'],
		mode_constraints: {
			disabled_in: ['print', 'json', 'rpc'],
			reason: 'Startup screen only renders in the interactive TUI',
		},
		load: async () =>
			(await import('./startup-screen/index.js')).default,
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
		aliases: ['prompt-preset', 'preset', 'presets'],
		load: async () =>
			(await import('./prompt-presets/index.js')).default,
	},
	{
		key: 'turn-timer',
		label: 'Turn timer',
		docs_label: 'Turn timer',
		description:
			'Live elapsed timer beside the working spinner with persisted turn durations',
		default_enabled: true,
		option_name: 'turn_timer',
		cli_arg: 'no-turn-timer',
		cli_flag: '--no-turn-timer',
		cli_description: 'Disable the working spinner turn timer',
		aliases: ['turn-timer', 'timer', 'elapsed-time'],
		mode_constraints: {
			disabled_in: ['print', 'json', 'rpc'],
			reason: 'The live timer is only useful in the interactive TUI',
		},
		load: async () => (await import('./turn-timer/index.js')).default,
	},
	{
		key: 'git-ui',
		label: 'Git UI',
		docs_label: 'Git staging UI',
		description: 'Interactive source control staging panel',
		default_enabled: true,
		option_name: 'git_ui',
		cli_arg: 'no-git-ui',
		cli_flag: '--no-git-ui',
		cli_description: 'Disable built-in Git staging UI',
		aliases: ['git-ui', 'git', 'source-control', 'scm'],
		mode_constraints: {
			disabled_in: ['print', 'json', 'rpc'],
			reason: 'Git UI is only useful in interactive mode',
		},
		external_package_name: '@spences10/pi-git-ui',
		load: async () => (await import('@spences10/pi-git-ui')).default,
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
		external_package_name: '@spences10/pi-lsp',
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
		external_package_name: '@spences10/pi-confirm-destructive',
		load: async () =>
			(await import('@spences10/pi-confirm-destructive')).default,
	},
	{
		key: 'hooks-resolution',
		label: 'Hooks resolution',
		docs_label: 'Hooks resolution',
		description:
			'Claude Code style PreToolUse and PostToolUse hook compatibility from .claude, .rulesync, and .pi configs',
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
		key: 'svelte-guardrails',
		label: 'Svelte guardrails',
		docs_label: 'Svelte guardrails',
		description:
			'Blocks discouraged Svelte patterns like $effect before agents write them',
		default_enabled: true,
		option_name: 'svelte_guardrails',
		cli_arg: 'no-svelte-guardrails',
		cli_flag: '--no-svelte-guardrails',
		cli_description: 'Disable Svelte guardrails',
		aliases: ['svelte-guardrails', 'svelte'],
		external_package_name: '@spences10/pi-svelte-guardrails',
		load: async () =>
			(await import('@spences10/pi-svelte-guardrails')).default,
	},
	{
		key: 'coding-preferences',
		label: 'Coding preferences',
		docs_label: 'Coding preferences',
		description:
			'Blocks configured coding workflow anti-patterns from JSON preferences',
		default_enabled: true,
		option_name: 'coding_preferences',
		cli_arg: 'no-coding-preferences',
		cli_flag: '--no-coding-preferences',
		cli_description: 'Disable coding preferences guardrails',
		aliases: ['coding-preferences', 'preferences', 'prefs'],
		external_package_name: '@spences10/pi-coding-preferences',
		load: async () =>
			(await import('@spences10/pi-coding-preferences')).default,
	},
	{
		key: 'handoff',
		label: 'Handoff',
		docs_label: 'Handoff',
		description:
			'Help command for Pi continuation primitives like /fork, /tree, /export, /import, and /share',
		default_enabled: true,
		option_name: 'handoff',
		cli_arg: 'no-handoff',
		cli_flag: '--no-handoff',
		cli_description: 'Disable handoff helper command',
		aliases: ['handoff', 'continuation'],
		load: async () => (await import('./handoff/index.js')).default,
	},
	{
		key: 'team-mode',
		label: 'Team mode',
		docs_label: 'Team mode',
		description:
			'Peer coordination between independently opened Pi sessions with groups, artifacts, and durable mailboxes',
		default_enabled: true,
		option_name: 'team_mode',
		cli_arg: 'no-team-mode',
		cli_flag: '--no-team-mode',
		cli_description: 'Disable peer-session team mode extension',
		aliases: ['team-mode', 'team', 'teammates'],
		external_package_name: '@spences10/pi-team-mode',
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
