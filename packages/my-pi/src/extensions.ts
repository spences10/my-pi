import type {
	ExtensionAPI,
	ExtensionFactory,
} from '@earendil-works/pi-coding-agent';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface MyPiExtension {
	/** Saved in my-pi-settings.json `extensions.enabled`. */
	key: string;
	label: string;
	description: string;
	load: () => Promise<ExtensionFactory>;
}

type ExtensionModule = { default: ExtensionFactory };

const require = createRequire(import.meta.url);

function package_dir(entry_url: string): string {
	// <package>/dist/index.js -> <package>
	return dirname(dirname(fileURLToPath(entry_url)));
}

function with_resources(
	factory: ExtensionFactory,
	resources: { skillPaths?: string[]; themePaths?: string[] },
): ExtensionFactory {
	return async (pi: ExtensionAPI) => {
		pi.on('resources_discover', () => resources);
		await factory(pi);
	};
}

export const EXTENSIONS: readonly MyPiExtension[] = [
	{
		key: 'filter-output',
		label: 'Secret redaction',
		description: 'Redacts likely secrets from tool output',
		load: async () =>
			((await import('@spences10/pi-redact')) as ExtensionModule)
				.default,
	},
	{
		key: 'confirm-destructive',
		label: 'Confirm destructive',
		description: 'Asks before destructive shell commands',
		load: async () =>
			(
				(await import('@spences10/pi-confirm-destructive')) as ExtensionModule
			).default,
	},
	{
		key: 'context-sidecar',
		label: 'Context sidecar',
		description: 'Searchable SQLite store for oversized tool output',
		load: async () =>
			((await import('@spences10/pi-context')) as ExtensionModule)
				.default,
	},
	{
		key: 'lsp',
		label: 'LSP',
		description: 'Language-server diagnostics and symbol tools',
		load: async () =>
			((await import('@spences10/pi-lsp')) as ExtensionModule)
				.default,
	},
	{
		key: 'recall',
		label: 'Recall',
		description: 'pirecall sync and past-session reminders',
		load: async () =>
			((await import('@spences10/pi-recall')) as ExtensionModule)
				.default,
	},
	{
		key: 'telemetry',
		label: 'Telemetry',
		description: 'Local SQLite telemetry; /telemetry on to record',
		load: async () =>
			((await import('@spences10/pi-telemetry')) as ExtensionModule)
				.default,
	},
	{
		key: 'observability',
		label: 'Observability',
		description: 'Live event stream and browser dashboard',
		load: async () =>
			(
				(await import('@spences10/pi-observability')) as ExtensionModule
			).default,
	},
	{
		key: 'team-mode',
		label: 'Team mode',
		description: 'Coordination between open Pi sessions',
		load: async () =>
			((await import('@spences10/pi-team-mode')) as ExtensionModule)
				.default,
	},
	{
		key: 'harness',
		label: 'Harness',
		description: 'Ephemeral task harness runtime and skills',
		load: async () => {
			const entry = import.meta.resolve('@spences10/pi-harness');
			const { default: factory } = (await import(
				entry
			)) as ExtensionModule;
			return with_resources(factory, {
				skillPaths: [join(package_dir(entry), 'skills')],
			});
		},
	},
	{
		key: 'git-ui',
		label: 'Git UI',
		description: 'Interactive staging, diff review, and commit',
		load: async () =>
			((await import('@spences10/pi-git-ui')) as ExtensionModule)
				.default,
	},
	{
		key: 'footer',
		label: 'Footer',
		description: 'Configurable footer status line',
		load: async () =>
			((await import('@spences10/pi-footer')) as ExtensionModule)
				.default,
	},
	{
		key: 'codex-usage',
		label: 'Codex usage',
		description: 'OpenAI Codex usage in the footer',
		load: async () =>
			((await import('@spences10/pi-codex-usage')) as ExtensionModule)
				.default,
	},
	{
		key: 'kimi-usage',
		label: 'Kimi usage',
		description: 'Kimi For Coding usage in the footer',
		load: async () =>
			((await import('@spences10/pi-kimi-usage')) as ExtensionModule)
				.default,
	},
	{
		key: 'coding-preferences',
		label: 'Coding preferences',
		description: 'Configurable coding-workflow guardrails',
		load: async () =>
			(
				(await import('@spences10/pi-coding-preferences')) as ExtensionModule
			).default,
	},
	{
		key: 'svelte-guardrails',
		label: 'Svelte guardrails',
		description: 'Blocks discouraged Svelte patterns',
		load: async () =>
			(
				(await import('@spences10/pi-svelte-guardrails')) as ExtensionModule
			).default,
	},
	{
		key: 'talk',
		label: 'Talk',
		description: 'Hold-Space Deepgram dictation',
		load: async () =>
			((await import('@spences10/pi-talk')) as ExtensionModule)
				.default,
	},
	{
		key: 'starfield',
		label: 'Starfield',
		description: 'Twinkling stars in the input editor',
		load: async () =>
			((await import('@spences10/pi-starfield')) as ExtensionModule)
				.default,
	},
	{
		key: 'themes',
		label: 'Themes',
		description:
			'Bundled theme pack; choose one in /settings (restart to apply)',
		// Loaded with --theme at startup; see theme_args().
		load: async () => () => {},
	},
];

/** Pi applies the saved theme before extensions load, so themes go in as a CLI path. */
export function themes_dir(): string {
	return join(
		dirname(require.resolve('@spences10/pi-themes/package.json')),
		'themes',
	);
}
