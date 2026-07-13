import type { SchemaOrgProps, SeoConfig } from 'svead';

export const seo_config: SeoConfig = {
	title: 'my-pi — a curated Pi coding-agent distribution',
	description:
		'Run a ready-to-use Pi coding-agent CLI, or add individual @spences10/pi-* extensions to your own Pi setup.',
	url: 'https://github.com/spences10/my-pi',
	website: 'github.com/spences10/my-pi',
	site_name: 'my-pi',
	twitter_card_type: 'summary',
};

export const logo_lines = [
	'███╗   ███╗                  ██████╗ ██╗',
	'████╗ ████║ ██╗   ██╗        ██╔══██╗   ',
	'██╔████╔██║ ╚██╗ ██╔╝ ████╗  ██████╔╝██╗',
	'██║╚██╔╝██║  ╚████╔╝ ╚═══╝   ██╔═══╝ ██║',
	'██║ ╚═╝ ██║   ╚██╔╝          ██║     ██║',
	'╚═╝     ╚═╝   ██╔╝           ╚═╝     ╚═╝',
] as const;

export const stack_tree = [
	['runtime', 'TUI · print · JSON · RPC · SDK'],
	['project tools', 'MCP · LSP · skills'],
	['context', 'sidecar · recall · redaction'],
	['workflows', 'presets · harness · team mode'],
	['operations', 'Git UI · telemetry · observability'],
] as const;

export const stack_rows = [
	{
		label: 'Finish with evidence, not confidence',
		packages: 'pi-lsp  project checks',
		body: 'Inspect the diff, run the narrow check and test, then query diagnostics on changed files before handing work back.',
	},
	{
		label: 'Keep large output searchable',
		packages: 'pi-context',
		body: 'Large reads and tool results become compact receipts; search snippets first, retrieve nearby chunks, and export only for broad offline processing.',
	},
	{
		label: 'Continue from earlier decisions',
		packages: 'pi-recall',
		body: 'Earlier sessions answer “what did we decide?” so work resumes with the original constraints, inspected files, and validation state.',
	},
	{
		label: 'Delegate implementation; keep final review',
		packages: 'pi-team-mode',
		body: 'Independent Pi sessions carry research and implementation, return results through messages and artifacts, and leave final integration to the lead.',
	},
	{
		label: 'Constrain risky work before it starts',
		packages: 'pi-harness',
		body: 'Constrain editable paths and commands, encode validation, log evidence, and check for drift before a delegated task is complete.',
	},
	{
		label: 'Use credentials without putting them in chat',
		packages: 'pi-nopeek  pi-redact',
		body: 'Discover available key names, load only what a command needs, and return the result without putting the credential into chat.',
	},
	{
		label: 'See why an agent run failed',
		packages: 'pi-telemetry  pi-observability',
		body: 'Local usage data and live traces expose slow requests, noisy tools, failed calls, and coordination state while work is happening.',
	},
	{
		label: 'Load only what the repository needs',
		packages: 'pi-mcp  pi-skills  native project tools',
		body: 'Activate relevant MCP servers and skills by project, then follow that repository’s own README, agent guidance, and validation flow.',
	},
] as const;

export const package_groups = [
	{
		label: 'agent essentials',
		prompt: 'inspect',
		packages: [
			[
				'pi-lsp',
				'Language-server diagnostics, hover, definitions, references, and symbols.',
			],
			[
				'pi-mcp',
				'Project-aware MCP servers, tool discovery, and the /mcp control surface.',
			],
			[
				'pi-context',
				'A searchable SQLite sidecar for oversized tool output.',
			],
			[
				'pi-skills',
				'Skill discovery, profiles, import, enablement, and sync.',
			],
			[
				'pi-harness',
				'Ephemeral, contract-driven runtimes for implementation and review.',
			],
		] as const,
	},
	{
		label: 'memory & operations',
		prompt: 'operate',
		packages: [
			[
				'pi-recall',
				'Prior-session recall reminders and background sync.',
			],
			[
				'pi-observability',
				'A live local event stream with browser and terminal dashboards.',
			],
			[
				'pi-telemetry',
				'Local SQLite telemetry, queries, exports, and eval metadata.',
			],
			[
				'pi-team-mode',
				'Coordination for independent Pi sessions, groups, artifacts, and mailboxes.',
			],
			[
				'pi-git-ui',
				'Interactive source-control staging and commit workflows.',
			],
		] as const,
	},
	{
		label: 'safety & guidance',
		prompt: 'guard',
		packages: [
			[
				'pi-redact',
				'Sensitive-output redaction with session statistics.',
			],
			[
				'pi-nopeek',
				'Prompts agents toward secret-safe environment loading.',
			],
			[
				'pi-confirm-destructive',
				'Explicit confirmation before destructive actions.',
			],
			[
				'pi-coding-preferences',
				'Configurable coding-workflow guardrails.',
			],
			[
				'pi-svelte-guardrails',
				'Checks that block configured Svelte anti-patterns.',
			],
			[
				'pi-omnisearch',
				'Prompts agents toward source-verified web research.',
			],
			[
				'pi-sqlite-tools',
				'Prompts agents toward safer structured SQLite operations.',
			],
			[
				'pi-themes',
				'A bundled theme pack selected through Pi settings.',
			],
		] as const,
	},
] as const;

export const support_packages = [
	'pi-child-env',
	'pi-footer',
	'pi-project-trust',
	'pi-settings',
	'pi-skill-importer',
	'pi-sqlite-core',
	'pi-tui-modal',
] as const;

export const faq_lines = [
	[
		'Is my-pi a replacement for Pi?',
		'No. Pi is the underlying coding-agent CLI and SDK. my-pi runs Pi with a selected set of extensions and defaults already configured.',
	],
	[
		'How do I run the full distribution?',
		'Run pnpx my-pi@latest (or npx/bunx). The root package is its own CLI wrapper; do not install it with pi install.',
	],
	[
		'Can I use the packages without my-pi?',
		'Yes. The user-installable @spences10/pi-* extensions can be installed independently. For example: pi install npm:@spences10/pi-lsp.',
	],
	[
		'Are all published packages direct installs?',
		'No. Packages such as pi-settings, pi-project-trust, pi-sqlite-core, and pi-tui-modal are shared implementation dependencies. The installable package list separates them from direct-install extensions.',
	],
	[
		'Where is the configuration reference?',
		'Each package README is the source of truth for its commands, configuration, runtime behavior, and local-development instructions.',
	],
] as const;

export const page_schema: SchemaOrgProps['schema'] = [
	{
		'@type': 'SoftwareApplication',
		name: 'my-pi',
		applicationCategory: 'DeveloperApplication',
		operatingSystem: 'Linux, macOS, Windows',
		description: seo_config.description,
		offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
	},
	{
		'@type': 'SoftwareSourceCode',
		name: 'my-pi source code',
		codeRepository: 'https://github.com/spences10/my-pi',
		programmingLanguage: 'TypeScript',
		runtimePlatform: 'Node.js',
		description:
			'Source for the my-pi distribution and independently installable Pi extension packages.',
	},
	{
		'@type': 'FAQPage',
		mainEntity: faq_lines.map(([question, answer]) => ({
			'@type': 'Question',
			name: question,
			acceptedAnswer: { '@type': 'Answer', text: answer },
		})),
	},
];
