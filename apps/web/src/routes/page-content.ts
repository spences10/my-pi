import { site_config } from '#lib/config/site.js';
import type { SchemaOrgProps, SeoConfig } from 'svead';

const share_card_url = `${site_config.url}${site_config.share_card.path}`;

export const seo_config: SeoConfig = {
	title: site_config.title,
	description: site_config.description,
	url: `${site_config.url}/`,
	website: new URL(site_config.url).host,
	language: 'en_GB',
	site_name: site_config.name,
	author_name: site_config.author.name,
	open_graph_image: share_card_url,
	open_graph_image_alt: site_config.share_card.alt,
	twitter_card_type: 'summary_large_image',
};

export const stack_tree = [
	['runtime', 'upstream Pi: TUI · MCP · skills · RPC · SDK'],
	['project tools', 'LSP · guardrails'],
	['context', 'sidecar · recall · redaction'],
	['workflows', 'harness · team mode'],
	['operations', 'Git UI · telemetry · observability · usage'],
] as const;

// Packages that supply each stack layer. The runtime layer is Pi itself.
export const layer_packages: Record<string, readonly string[]> = {
	runtime: [],
	'project tools': [
		'pi-lsp',
		'pi-confirm-destructive',
		'pi-coding-preferences',
		'pi-svelte-guardrails',
	],
	context: ['pi-context', 'pi-recall', 'pi-redact'],
	workflows: ['pi-harness', 'pi-team-mode'],
	operations: [
		'pi-git-ui',
		'pi-telemetry',
		'pi-observability',
		'pi-codex-usage',
		'pi-kimi-usage',
	],
};

export const stack_rows = [
	{
		label: 'Finish with evidence, not confidence',
		packages: 'pi-lsp  project checks',
		body: 'Inspect the diff, run the narrow check and test, then query diagnostics on changed files before handing work back.',
	},
	{
		label: 'Get the next prompt ready',
		packages: 'pi-starfield',
		body: 'After each turn, the session model suggests your next prompt as dim text in the empty input. Press Tab to use it; typing hides it.',
	},
	{
		label: 'Stop risky commands before they run',
		packages: 'pi-confirm-destructive',
		body: 'Deletes, resets, force pushes, and other destructive commands wait for your confirmation, with Git-aware checks for work you could lose.',
	},
	{
		label: 'Review and commit without leaving Pi',
		packages: 'pi-git-ui',
		body: 'Stage files, review diffs, and write the commit in a modal inside Pi instead of switching to a separate Git client.',
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
		packages: 'pi-redact',
		body: 'Discover available key names, load only what a command needs, and return the result without putting the credential into chat.',
	},
	{
		label: 'See why an agent run failed',
		packages: 'pi-telemetry  pi-observability',
		body: 'Local usage data and live traces expose slow requests, noisy tools, failed calls, and coordination state while work is happening.',
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
				'pi-context',
				'A searchable SQLite sidecar for oversized tool output.',
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
		] as const,
	},
	{
		label: 'terminal & usage',
		prompt: 'style',
		packages: [
			['pi-footer', 'A configurable footer status line.'],
			['pi-codex-usage', 'OpenAI Codex usage status in the footer.'],
			[
				'pi-kimi-usage',
				'Kimi For Coding usage status in the footer.',
			],
			[
				'pi-themes',
				'A bundled theme pack selected through Pi settings.',
			],
			[
				'pi-starfield',
				'Input stars and a suggested next prompt (Tab).',
			],
			['pi-talk', 'Opt-in hold-Space Deepgram dictation.'],
		] as const,
	},
] as const;

export const support_packages = [
	'pi-child-env',
	'pi-project-trust',
	'pi-settings',
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
		'Run pnpx my-pi@latest (or npx/bunx). It runs upstream Pi with every extension in this repository built in; do not install it with pi install.',
	],
	[
		'How do I turn an extension off?',
		'Run /extensions inside my-pi. The choice is saved in ~/.pi/agent/my-pi-settings.json and applies on reload.',
	],
	[
		'Where are MCP, skills, and models?',
		'They are upstream Pi features. Every Pi option and subcommand, including my-pi config and my-pi install, works in my-pi.',
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

const author = {
	'@type': 'Person',
	name: site_config.author.name,
	url: site_config.author.url,
} as const;

// `version` is the published npm version, or null when it is not known.
export const page_schema = (
	version: string | null,
): SchemaOrgProps['schema'] => [
	{
		'@type': 'WebSite',
		name: site_config.name,
		url: `${site_config.url}/`,
		description: seo_config.description,
		inLanguage: 'en-GB',
		author,
	},
	{
		'@type': 'SoftwareApplication',
		name: 'my-pi',
		url: `${site_config.url}/`,
		image: share_card_url,
		applicationCategory: 'DeveloperApplication',
		operatingSystem: 'Linux, macOS, Windows',
		description: seo_config.description,
		downloadUrl: site_config.npm,
		...(version ? { softwareVersion: version } : {}),
		author,
		offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
	},
	{
		'@type': 'SoftwareSourceCode',
		name: 'my-pi source code',
		codeRepository: site_config.repository,
		programmingLanguage: 'TypeScript',
		runtimePlatform: 'Node.js',
		author,
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
