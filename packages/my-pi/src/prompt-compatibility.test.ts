import {
	DefaultResourceLoader,
	ExtensionRunner,
	SessionManager,
	type InlineExtension,
	type ModelRegistry,
} from '@earendil-works/pi-coding-agent';
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
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vite-plus/test';
import { EXTENSIONS } from './extensions.js';

const dirs: string[] = [];
const original_agent_dir = process.env.PI_CODING_AGENT_DIR;
afterEach(() => {
	if (original_agent_dir === undefined)
		delete process.env.PI_CODING_AGENT_DIR;
	else process.env.PI_CODING_AGENT_DIR = original_agent_dir;
	for (const dir of dirs.splice(0))
		rmSync(dir, { recursive: true, force: true });
});

describe('Pi prompt compatibility', () => {
	it('discovers distributed skills with Pi package loading and no user skills or MCP setup', async () => {
		const root = mkdtempSync(join(tmpdir(), 'my-pi-native-skills-'));
		dirs.push(root);
		process.env.PI_CODING_AGENT_DIR = root;
		const package_path = fileURLToPath(
			new URL(
				'../',
				import.meta.resolve('@spences10/pi-tool-guidance'),
			),
		);
		const loader = new DefaultResourceLoader({
			cwd: root,
			agentDir: root,
			noContextFiles: true,
			additionalExtensionPaths: [package_path],
		});
		await loader.reload();
		expect(loader.getExtensions().errors).toEqual([]);
		expect(loader.getSkills().diagnostics).toEqual([]);
		expect(
			loader.getSkills().skills.map((skill) => skill.name),
		).toEqual(
			expect.arrayContaining([
				'my-pi-nopeek',
				'my-pi-omnisearch',
				'my-pi-sqlite',
			]),
		);
		expect(loader.getExtensions().extensions).toHaveLength(1);
		expect(loader.getExtensions().extensions[0]!.tools.size).toBe(0);
		expect(existsSync(join(root, 'mcp.json'))).toBe(false);
		expect(existsSync(join(root, 'auth.json'))).toBe(false);
	});
	it.each([false, true])(
		'composes real extension handlers with user prompt files (reverse order: %s)',
		async (reverse) => {
			const root = mkdtempSync(join(tmpdir(), 'my-pi-prompt-'));
			dirs.push(root);
			const agentDir = join(root, 'agent');
			const cwd = join(root, 'project');
			mkdirSync(agentDir);
			mkdirSync(cwd);
			process.env.PI_CODING_AGENT_DIR = agentDir;
			writeFileSync(
				join(agentDir, 'SYSTEM.md'),
				'USER_SYSTEM_MARKER',
			);
			writeFileSync(
				join(agentDir, 'APPEND_SYSTEM.md'),
				'USER_APPEND_MARKER',
			);
			const keys = [
				'tool-guidance',
				'lsp',
				'recall',
				'team-mode',
				'harness',
			];
			if (reverse) keys.reverse();
			const factories: InlineExtension[] = await Promise.all(
				keys.map(async (key) => ({
					name: key,
					factory: await EXTENSIONS.find(
						(entry) => entry.key === key,
					)!.load(),
				})),
			);
			let rendered = '';
			factories.push({
				name: 'late-section-probe',
				factory: (pi) => {
					pi.on('before_agent_start', (event, ctx) => {
						event.systemPromptOptions.sections.late_probe =
							'LATE_SECTION_MARKER';
						rendered = ctx.getSystemPrompt();
					});
				},
			});
			const loader = new DefaultResourceLoader({
				cwd,
				agentDir,
				extensionFactories: factories,
				noContextFiles: true,
			});
			await loader.reload();
			const loaded = loader.getExtensions();
			expect(loaded.errors).toEqual([]);
			loaded.runtime.getAllTools = () => [];
			const runner = new ExtensionRunner(
				loaded.extensions,
				loaded.runtime,
				cwd,
				SessionManager.inMemory(cwd),
				{} as ModelRegistry,
			);
			const errors: unknown[] = [];
			runner.onError((error) => errors.push(error));
			try {
				const result = await runner.emitBeforeAgentStart(
					{
						messageType: 'user',
						prompt: 'Review code',
						images: undefined,
					},
					{
						cwd,
						customPrompt: loader.getSystemPrompt(),
						appendSystemPrompt: loader
							.getAppendSystemPrompt()
							.join('\n'),
						selectedTools: [
							'bash',
							'lsp_diagnostics',
							'team',
							'codemode',
						],
						sections: {
							mcp_servers:
								'- mcp__mcp_omnisearch (codemode)\n- mcp__mcp_sqlite_tools (codemode)',
						},
					},
				);
				expect(errors).toEqual([]);
				expect(
					result.systemPromptOptions.forceSystemPrompt,
				).toBeUndefined();
				for (const text of [
					'USER_SYSTEM_MARKER',
					'USER_APPEND_MARKER',
					'Secret-safe commands',
					'Web research',
					'SQLite databases',
					'Language server support',
					'Session Recall',
					'Team Mode',
					'harness',
					'LATE_SECTION_MARKER',
				])
					expect(rendered).toContain(text);
				for (const key of [
					'lsp',
					'session_recall',
					'team_mode',
					'harness',
					'my_pi_tool_guidance',
				])
					expect(
						result.systemPromptOptions.sections[key],
					).toBeTruthy();
				expect(
					readFileSync(join(agentDir, 'SYSTEM.md'), 'utf8'),
				).toBe('USER_SYSTEM_MARKER');
				expect(
					readFileSync(join(agentDir, 'APPEND_SYSTEM.md'), 'utf8'),
				).toBe('USER_APPEND_MARKER');
			} finally {
				await runner.emit({
					type: 'session_shutdown',
					reason: 'reload',
				});
			}
		},
	);
});
