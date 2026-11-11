import {
	fauxAssistantMessage,
	fauxProvider,
	fauxToolCall,
} from '@earendil-works/pi-ai';
import {
	createAgentSession,
	createCodemodeExtension,
	DefaultResourceLoader,
	ModelRuntime,
	SessionManager,
	SettingsManager,
	type ExtensionUIContext,
	type ToolCallEvent,
} from '@earendil-works/pi-coding-agent';
import coding_preferences, {
	default_config,
	type NamingConfig,
} from '@spences10/pi-coding-preferences';
import svelte_guardrails from '@spences10/pi-svelte-guardrails';
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';

type Case = {
	name: string;
	tool: 'write' | 'edit' | 'bash';
	input: Parameters<typeof fauxToolCall>[1];
	initial?: string;
	expected?: string;
	blocked?: string;
	mode?: 'block' | 'warn' | 'off';
	allow?: string[];
	file?: string;
	warning?: boolean;
	naming?: NamingConfig | false;
	global_naming?: NamingConfig | false;
};

const effect = '<script>$effect(() => {});</script>';
const derived = '<script>const value = $derived(count);</script>';

const cases: Case[] = [
	{
		name: 'automatic naming blocks a new project write',
		tool: 'write',
		input: { path: 'naming.ts', content: 'const badName = 1;' },
		blocked: 'naming.variables',
	},
	{
		name: 'retry after a rejected write succeeds',
		tool: 'write',
		input: { path: 'naming.ts', content: 'const good_name = 1;' },
	},
	{
		name: 'automatic naming blocks a function declaration',
		tool: 'write',
		input: { path: 'function.ts', content: 'function badName() {}' },
		blocked: 'naming.functions',
	},
	{
		name: 'automatic naming blocks a type declaration',
		tool: 'write',
		input: { path: 'type.ts', content: 'interface bad_name {}' },
		blocked: 'naming.types',
	},
	{
		name: 'identifier-only edit is checked in full file context',
		tool: 'edit',
		initial: 'const good_name = 1;',
		input: {
			path: 'identifier.ts',
			edits: [{ oldText: 'good_name', newText: 'badName' }],
		},
		blocked: 'naming.variables',
	},
	{
		name: 'bad declaration in a later batched edit leaves file unchanged',
		tool: 'edit',
		initial: 'const first_name = 1;\nconst second_name = 2;',
		input: {
			path: 'naming-batch.ts',
			edits: [
				{ oldText: 'first_name', newText: 'better_name' },
				{ oldText: 'second_name', newText: 'badName' },
			],
		},
		blocked: 'naming.variables',
	},
	{
		name: 'removing legacy naming violations succeeds',
		tool: 'edit',
		initial: 'const badName = 1;',
		input: {
			path: 'naming-fix.ts',
			edits: [{ oldText: 'badName', newText: 'good_name' }],
		},
		expected: 'const good_name = 1;',
	},
	{
		name: 'untouched legacy violations do not block another edit',
		tool: 'edit',
		initial: 'const legacyName = 1;\nconst good_name = 2;',
		input: {
			path: 'naming-legacy.ts',
			edits: [{ oldText: 'good_name', newText: 'better_name' }],
		},
		expected: 'const legacyName = 1;\nconst better_name = 2;',
	},
	{
		name: 'rewrites cannot introduce extra naming violations',
		tool: 'write',
		initial: 'const legacyName = 1;',
		input: {
			path: 'naming-rewrite.ts',
			content: 'const legacyName = 1;\nconst anotherName = 2;',
		},
		blocked: 'anotherName',
	},
	{
		name: 'invalid proposed syntax is rejected before writing',
		tool: 'edit',
		initial: 'const good_name = 1;',
		input: {
			path: 'naming-syntax.ts',
			edits: [{ oldText: '1', newText: '' }],
		},
		blocked: 'Cannot validate naming',
	},
	{
		name: 'Svelte script naming is enforced without project linting',
		tool: 'write',
		input: {
			path: 'Naming.svelte',
			content: '<script lang="ts">let badName = $state(0);</script>',
		},
		blocked: 'naming.variables',
	},
	{
		name: 'global naming style applies without project configuration',
		tool: 'write',
		global_naming: { variables: 'camelCase' },
		input: {
			path: 'naming-global.ts',
			content: 'const goodName = 1;',
		},
	},
	{
		name: 'global naming disable applies without project configuration',
		tool: 'write',
		global_naming: false,
		input: {
			path: 'naming-global-off.ts',
			content: 'const badName = 1;',
		},
	},
	{
		name: 'explicit naming disable is honored',
		tool: 'write',
		naming: false,
		input: {
			path: 'naming-disabled.ts',
			content: 'const badName = 1;',
		},
	},
	{
		name: 'project naming style override is honored',
		tool: 'write',
		naming: { variables: 'camelCase' },
		input: {
			path: 'naming-custom.ts',
			content: 'const goodName = 1;',
		},
	},
	{
		name: 'workflow command restriction',
		tool: 'bash',
		input: { command: 'cat package.json' },
		blocked: 'prefer-read-tool',
	},
	{
		name: 'path restriction on writes',
		tool: 'write',
		input: { path: 'protected.ts', content: 'safe' },
		blocked: 'protected-path',
	},
	{
		name: 'path restriction on edits',
		tool: 'edit',
		initial: 'safe',
		input: {
			path: 'protected.ts',
			edits: [{ oldText: 'safe', newText: 'changed' }],
		},
		blocked: 'protected-path',
	},
	{
		name: 'proposed write content restriction',
		tool: 'write',
		input: { path: 'restricted.ts', content: 'restricted_marker' },
		blocked: 'input.content',
	},
	{
		name: 'later replacement in a batch',
		tool: 'edit',
		initial: 'one\ntwo',
		input: {
			path: 'batch.ts',
			edits: [
				{ oldText: 'one', newText: 'safe' },
				{ oldText: 'two', newText: 'restricted_marker' },
			],
		},
		blocked: 'input.edits[1].newText',
	},
	{
		name: 'corrective content edit',
		tool: 'edit',
		initial: 'restricted_marker',
		input: {
			path: 'correction.ts',
			edits: [{ oldText: 'restricted_marker', newText: 'safe' }],
		},
		expected: 'safe',
	},
	{
		name: 'prose and external API names are left to language tooling',
		tool: 'write',
		input: {
			path: 'prose.ts',
			content:
				"import { runCommand } from 'citty';\nthrow new Error('--type must be user, assistant, toolResult, or all');\ntest('type combines with project', () => {});",
		},
	},
	{
		name: 'default Svelte policy blocks writes',
		tool: 'write',
		input: { path: 'Default.svelte', content: effect },
		blocked: 'policy disallows $effect',
	},
	{
		name: 'explicit advisory Svelte edits execute',
		tool: 'edit',
		mode: 'warn',
		initial: '<p>placeholder</p>',
		input: {
			path: 'WarnEdit.svelte',
			edits: [{ oldText: '<p>placeholder</p>', newText: effect }],
		},
		expected: effect,
		warning: true,
	},
	{
		name: 'explicit Svelte block on writes',
		tool: 'write',
		mode: 'block',
		input: { path: 'Block.svelte', content: effect },
		blocked: 'policy disallows $effect',
	},
	{
		name: 'default Svelte policy blocks batched edits',
		tool: 'edit',
		initial: 'one\ntwo',
		input: {
			path: 'BlockEdit.svelte',
			edits: [
				{ oldText: 'one', newText: '<p>one</p>' },
				{ oldText: 'two', newText: effect },
			],
		},
		blocked: 'policy disallows $effect',
	},
	{
		name: 'removing an effect under strict policy',
		tool: 'edit',
		mode: 'block',
		initial: effect,
		input: {
			path: 'Remove.svelte',
			edits: [{ oldText: effect, newText: derived }],
		},
		expected: derived,
	},
	{
		name: 'Svelte path exception',
		tool: 'write',
		mode: 'block',
		allow: ['Allowed.svelte'],
		input: { path: 'Allowed.svelte', content: effect },
	},
	{
		name: 'default Svelte policy blocks recognized shell writes',
		tool: 'bash',
		input: { command: `printf '%s' '${effect}' > Bash.svelte` },
		file: 'Bash.svelte',
		blocked: 'policy disallows $effect',
	},
	{
		name: 'explicit advisory shell write',
		tool: 'bash',
		mode: 'warn',
		input: { command: `printf '%s' '${effect}' > BashWarn.svelte` },
		file: 'BashWarn.svelte',
		expected: effect,
		warning: true,
	},
	{
		name: 'external import does not grant a policy exception',
		tool: 'write',
		input: {
			path: 'External.svelte',
			content:
				"<script>import chart from 'external-library'; $effect(() => chart());</script>",
		},
		blocked: 'External library imports do not grant an exception',
	},
	{
		name: 'disabled Svelte policy',
		tool: 'write',
		mode: 'off',
		input: { path: 'Off.svelte', content: effect },
	},
];

afterEach(() => vi.unstubAllEnvs());

describe('guardrails through the real upstream tool execution pipeline', () => {
	it.each(['direct', 'codemode-on', 'codemode-only'] as const)(
		'enforces the same policies for %s calls',
		async (route) => {
			const dir = mkdtempSync(join(tmpdir(), 'guardrail-parity-'));
			vi.stubEnv('PI_CODING_AGENT_DIR', dir);
			mkdirSync(join(dir, '.pi'));
			writeFileSync(
				join(dir, 'my-pi-settings.json'),
				JSON.stringify({
					version: 1,
					codingPreferences: {
						rules: [
							...default_config.rules,
							{
								name: 'protected-path',
								toolNames: ['write', 'edit'],
								target: 'path',
								pattern: '^protected\\.',
								reason: 'Protected test path.',
							},
							{
								name: 'restricted-content',
								toolNames: ['write', 'edit'],
								target: 'content',
								pattern: 'restricted_marker',
								reason: 'Restricted test content.',
							},
						],
					},
				}),
			);

			const settings = SettingsManager.inMemory({
				compaction: { enabled: false },
				retry: { enabled: false },
			});

			const faux = fauxProvider({
				provider: 'guardrail-parity',
				tokensPerSecond: 1_000_000,
			});

			const runtime = await ModelRuntime.create({
				authPath: join(dir, 'auth.json'),
				modelsPath: null,
				modelsStorePath: join(dir, 'models-cache.json'),
				refreshOnCreate: false,
			});

			runtime.registerNativeProvider(faux.provider);
			const calls: ToolCallEvent[] = [];

			const loader = new DefaultResourceLoader({
				cwd: dir,
				agentDir: dir,
				settingsManager: settings,
				noSkills: true,
				noPromptTemplates: true,
				noThemes: true,
				noContextFiles: true,
				extensionFactories: [
					createCodemodeExtension({
						mode: route === 'codemode-only' ? 'only' : 'on',
					}),
					(pi) => {
						pi.on('tool_call', (event) => {
							calls.push(event);
						});
					},
					coding_preferences,
					svelte_guardrails,
				],
			});

			await loader.reload();

			const { session } = await createAgentSession({
				cwd: dir,
				agentDir: dir,
				model: faux.getModel(),
				modelRuntime: runtime,
				sessionManager: SessionManager.inMemory(dir),
				settingsManager: settings,
				resourceLoader: loader,
				tools: ['write', 'edit', 'bash', 'codemode'],
				thinkingLevel: 'off',
			});

			try {
				const errors: unknown[] = [];
				const warnings: string[] = [];
				await session.bindExtensions({
					onError: (error) => errors.push(error),
					uiContext: {
						notify: (message: string) => {
							warnings.push(message);
						},
					} as ExtensionUIContext,
				});
				session.setActiveToolsByName([
					'write',
					'edit',
					'bash',
					'codemode',
				]);

				const user_settings = JSON.parse(
					readFileSync(join(dir, 'my-pi-settings.json'), 'utf8'),
				);

				for (const [index, test_case] of cases.entries()) {
					const { name, tool, input, initial, expected, blocked } =
						test_case;

					const allowed = { allow: test_case.allow ?? [] };

					const guardrail_settings = test_case.mode
						? { ...allowed, mode: test_case.mode }
						: allowed;

					writeFileSync(
						join(dir, '.pi', 'svelte-guardrails.json'),
						JSON.stringify(guardrail_settings),
					);

					const project_preferences = join(
						dir,
						'.pi',
						'coding-preferences.json',
					);

					if (test_case.naming === undefined)
						rmSync(project_preferences, { force: true });
					else
						writeFileSync(
							project_preferences,
							JSON.stringify({ naming: test_case.naming }),
						);
					writeFileSync(
						join(dir, 'my-pi-settings.json'),
						JSON.stringify({
							...user_settings,
							codingPreferences: {
								...user_settings.codingPreferences,
								naming: test_case.global_naming,
							},
						}),
					);
					const target = test_case.file ?? input.path;

					const path =
						typeof target === 'string'
							? join(dir, target)
							: undefined;

					if (path && initial !== undefined)
						writeFileSync(path, initial);
					const id = `call-${index}`;
					const code = `return await tools.${tool}(${JSON.stringify(input)});`;
					faux.setResponses([
						fauxAssistantMessage(
							fauxToolCall(
								route === 'direct' ? tool : 'codemode',
								route === 'direct' ? input : { code },
								{ id },
							),
						),
						fauxAssistantMessage('Done.'),
					]);
					calls.length = 0;
					warnings.length = 0;
					await session.prompt(name);

					const result = session.messages
						.filter((message) => message.role === 'toolResult')
						.at(-1);

					expect(result, name).toBeDefined();

					if (result?.role !== 'toolResult')
						throw new Error(`Missing tool result: ${name}`);
					expect(result.isError, name).toBe(Boolean(blocked));

					if (blocked)
						expect(JSON.stringify(result.content), name).toContain(
							blocked,
						);

					const mutations = calls.filter(
						(call) => call.toolName === tool,
					);

					expect(mutations, name).toHaveLength(1);
					expect(mutations[0]?.input, name).toEqual(input);
					expect(mutations[0]?.parentToolCallId, name).toBe(
						route === 'direct' ? undefined : id,
					);

					if (path) {
						if (blocked && initial === undefined)
							expect(existsSync(path), name).toBe(false);
						else
							expect(readFileSync(path, 'utf8'), name).toBe(
								blocked ? initial : (expected ?? input.content),
							);
					}

					expect(warnings, name).toHaveLength(
						test_case.warning ? 1 : 0,
					);

					if (test_case.warning) {
						expect(warnings[0], name).toContain(
							'This tool call is allowed',
						);
						expect(warnings[0], name).not.toContain(
							'was not created or modified',
						);
					}

					expect(errors, name).toEqual([]);
				}
			} finally {
				session.dispose();
				rmSync(dir, { recursive: true, force: true });
			}
		},
		30_000,
	);
});
