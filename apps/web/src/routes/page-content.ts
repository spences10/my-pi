import type { SchemaOrgProps, SeoConfig } from 'svead';

export const seo_config: SeoConfig = {
	title: 'My-Pi',
	description:
		'A ready-to-run Pi CLI distribution with scoped MCP tools, project skills, context reduction, recall, LSP tools, redaction, telemetry, observability, and team mode.',
	url: 'https://github.com/spences10/my-pi',
	website: 'github.com/spences10/my-pi',
	site_name: 'My-Pi',
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

export const faq_lines = [
	[
		'What is my-pi?',
		'my-pi is a Pi coding-agent distribution for terminal-first development. It wires MCP tools, LSP diagnostics, project skills, recall, context reduction, redaction, telemetry, observability, and team mode into one install.',
	],
	[
		'Is my-pi different from Pi?',
		'Yes. Pi is the underlying coding-agent CLI and SDK. my-pi is the prewired distribution: it sets defaults, enables the extension stack, and publishes the same building blocks as reusable @spences10/pi-* packages.',
	],
	[
		'Can I install only part of my-pi?',
		'Yes. Most features are available as standalone packages. You can run the full distro with pnpx my-pi@latest, or install focused pieces such as @spences10/pi-lsp, @spences10/pi-mcp, @spences10/pi-context, or @spences10/pi-team-mode into an existing Pi installation.',
	],
	[
		'Does my-pi support scoped MCP servers?',
		'Yes. MCP servers can load globally or per project, with activation policies for cwd, GitHub org, and GitHub repo. That keeps org-specific search, browser, SQLite, or internal tools available only where they belong.',
	],
	[
		'Does my-pi include language-server tools?',
		'Yes. The LSP extension gives agents diagnostics, hover information, definitions, references, and document symbols through project language servers. The goal is safer edits: agents can inspect types and file-level errors before reporting that work is complete.',
	],
	[
		'How does my-pi reduce context usage?',
		'Large command output, reads, MCP responses, and LSP dumps can move into local searchable context. The agent gets a compact receipt, then searches or retrieves chunks only when needed. Current global context stats show 91.7% reduction and 10.6 MiB saved from chat.',
	],
	[
		'Does my-pi help protect secrets?',
		'Yes. my-pi includes output redaction, reminders to use secret-safe loading, and prompts around risky workflows. It is designed to steer agents away from pasting credentials into conversation context and toward tools that expose key names and command results without revealing secret values.',
	],
	[
		'Does my-pi include live observability?',
		'Yes. my-pi includes a local observability event stream and browser dashboard for watching sessions, teammates, tool calls, token usage, and trace-style activity as agents work.',
	],
	[
		'Can my-pi run multiple agents?',
		'Yes. Team mode creates local RPC teammates, tracks tasks and dependencies, sends mailbox messages, shows status, and can spawn mutating teammates in isolated git worktrees. Use it to delegate research, review, tests, or implementation without losing coordination.',
	],
] as const;

export const page_schema: SchemaOrgProps['schema'] = [
	{
		'@type': 'SoftwareApplication',
		name: 'my-pi',
		applicationCategory: 'DeveloperApplication',
		operatingSystem: 'Linux, macOS, Windows',
		description:
			'Pi CLI distribution with scoped MCP tools, project skills, context reduction, recall, LSP tools, redaction, telemetry, observability, and team mode.',
		offers: {
			'@type': 'Offer',
			price: '0',
			priceCurrency: 'USD',
		},
	},
	{
		'@type': 'SoftwareSourceCode',
		name: 'my-pi source code',
		codeRepository: 'https://github.com/spences10/my-pi',
		programmingLanguage: 'TypeScript',
		runtimePlatform: 'Node.js',
		description:
			'Source code for the my-pi Pi CLI distribution and reusable Pi extension packages.',
	},
	{
		'@type': 'WebSite',
		name: 'my-pi',
		url: 'https://github.com/spences10/my-pi',
		description:
			'Landing page for my-pi, a prewired Pi CLI distribution and reusable Pi packages.',
	},
	{
		'@type': 'FAQPage',
		mainEntity: faq_lines.map(([question, answer]) => ({
			'@type': 'Question',
			name: question,
			acceptedAnswer: {
				'@type': 'Answer',
				text: answer,
			},
		})),
	},
];

export const detail_lines = [
	[
		'Pi CLI distribution',
		'Runs the Pi coding-agent stack from the terminal: TUI, print mode, JSON events, RPC mode, SDK wiring, and the bundled my-pi extension set.',
	],
	[
		'Scoped MCP activation',
		'Load stdio or HTTP MCP servers globally or per project, with activation rules for cwd, GitHub org, and GitHub repo.',
	],
	[
		'LSP agent tools',
		'Expose language-server diagnostics, hover, definitions, references, and document symbols directly to the agent for safer code edits.',
	],
	[
		'Context reduction',
		'Move oversized command output, reads, MCP responses, and LSP dumps into searchable local context. Current global stats: 91.7% reduction and 10.6 MiB saved from chat.',
	],
	[
		'Secret and command guardrails',
		'Redact tool output, remind agents to use nopeek for env files, and require confirmation before destructive commands.',
	],
	[
		'Skills, recall, observability, and team mode',
		'Activate skills by cwd, GitHub org, or repo; recall previous sessions; watch live observability traces; and coordinate RPC teammates with tasks, mailboxes, status, and worktrees.',
	],
] as const;

export const compose_lines = [
	[
		'Run my-pi',
		'Use the CLI when you want Pi with MCP, LSP, context reduction, recall, skills, redaction, telemetry, observability, and team mode already wired together.',
		'pnpx my-pi@latest',
	],
	[
		'Add one extension',
		'Already have a Pi setup? Install the same feature packages one at a time: LSP, MCP, context, skills, recall, team mode, and more.',
		'pi install npm:@spences10/pi-lsp',
	],
	[
		'Scope by workspace',
		'Load MCP servers from mcp.json and activate skill profiles only for matching directories, GitHub orgs, or GitHub repos.',
		'mcp.json + skill profiles',
	],
] as const;

export const package_lines = [
	'context',
	'lsp',
	'mcp',
	'redact',
	'recall',
	'skills',
	'observability',
	'team-mode',
	'telemetry',
] as const;

export const safety_lines = [
	[
		'Context reduction',
		'Oversized output moves into searchable local context instead of bloating the active prompt.',
	],
	[
		'Secret-aware workflows',
		'Redaction and nopeek reminders steer agents away from exposing .env values and service tokens.',
	],
	[
		'Destructive-action friction',
		'Confirmations add an explicit stop before risky shell commands or file operations.',
	],
] as const;
