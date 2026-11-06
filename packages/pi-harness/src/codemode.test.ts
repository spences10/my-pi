import {
	createAgentSession,
	createCodemodeExtension,
	DefaultResourceLoader,
	ModelRuntime,
	SessionManager,
	SettingsManager,
	type ToolCallEvent,
} from '@earendil-works/pi-coding-agent';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vite-plus/test';
import harness from './extension.js';
import {
	HARNESS_CUSTOM_TYPE,
	type HarnessStatusFile,
} from './schema.js';

// Execute the wrapped codemode tool without a model request. Its nested calls
// still run through Pi's real tool validation, hooks, and cancellation pipeline.
describe('native codemode harness execution', () => {
	it.each(['passed', 'failed', 'blocked', 'cancelled'] as const)(
		'records %s checks through codemode → harness → bash',
		async (scenario) => {
			const cwd = mkdtempSync(join(tmpdir(), 'pi-harness-codemode-'));
			let harness_dir: string | undefined;
			let session:
				| Awaited<ReturnType<typeof createAgentSession>>['session']
				| undefined;
			try {
				execFileSync('git', ['-C', cwd, 'init'], { stdio: 'ignore' });
				const settings = SettingsManager.inMemory({
					compaction: { enabled: false },
					retry: { enabled: false },
				});
				const runtime = await ModelRuntime.create({
					authPath: join(cwd, 'auth.json'),
					modelsPath: null,
					modelsStorePath: join(cwd, 'models-cache.json'),
					refreshOnCreate: false,
				});
				const calls: ToolCallEvent[] = [];
				const controller = new AbortController();
				const loader = new DefaultResourceLoader({
					cwd,
					agentDir: cwd,
					settingsManager: settings,
					noExtensions: true,
					noSkills: true,
					noPromptTemplates: true,
					noThemes: true,
					noContextFiles: true,
					extensionFactories: [
						createCodemodeExtension({ mode: 'only' }),
						harness,
						(pi) => {
							pi.on('tool_call', (event) => {
								calls.push(event);
								if (event.toolName !== 'bash') return;
								if (scenario === 'blocked')
									return {
										block: true,
										reason: 'Validation permission denied',
									};
								if (scenario === 'cancelled') controller.abort();
							});
						},
					],
				});
				await loader.reload();
				const manager = SessionManager.inMemory(cwd);
				({ session } = await createAgentSession({
					cwd,
					agentDir: cwd,
					modelRuntime: runtime,
					sessionManager: manager,
					settingsManager: settings,
					resourceLoader: loader,
				}));
				const errors: unknown[] = [];
				await session.bindExtensions({
					onError: (error) => errors.push(error),
				});
				session.setActiveToolsByName(['bash', 'codemode']);
				const harness_tools = session
					.getAllTools()
					.filter((tool) => tool.name.startsWith('harness_'));
				expect(harness_tools).toHaveLength(6);
				for (const tool of harness_tools) {
					expect(tool.exposure).toBe('codemode');
					expect(session.getActiveToolNames()).not.toContain(
						tool.name,
					);
					expect(session.getCallableToolNames()).toContain(tool.name);
				}
				const codemode = session.agent.state.tools.find(
					(tool) => tool.name === 'codemode',
				)!;
				const run_code = async (
					id: string,
					code: string,
					signal?: AbortSignal,
				) => {
					session!.agent.state.messages = [
						...session!.agent.state.messages,
						{
							role: 'assistant',
							content: [
								{
									type: 'toolCall',
									id,
									name: 'codemode',
									arguments: { code },
								},
							],
							api: 'openai-completions',
							provider: 'test',
							model: 'test',
							usage: {
								input: 0,
								output: 0,
								cacheRead: 0,
								cacheWrite: 0,
								totalTokens: 0,
								cost: {
									input: 0,
									output: 0,
									cacheRead: 0,
									cacheWrite: 0,
									total: 0,
								},
							},
							stopReason: 'toolUse',
							timestamp: Date.now(),
						},
					];
					return codemode.execute(id, { code }, signal);
				};
				const creation = await run_code(
					'create-script',
					`text(ALL_TOOLS.filter(t => t.name.startsWith('harness_')));
return await tools.harness_create(${JSON.stringify({
						task: 'Verify nested completion',
						validation_commands: [
							scenario === 'failed' ? 'false' : 'true',
						],
					})});`,
				);
				expect(JSON.stringify(creation.content)).toContain(
					'Script completed',
				);
				for (const tool of harness_tools)
					expect(JSON.stringify(creation.content)).toContain(
						tool.name,
					);
				const entry = manager
					.getBranch()
					.find(
						(entry) =>
							entry.type === 'custom' &&
							entry.customType === HARNESS_CUSTOM_TYPE,
					);
				if (!entry || entry.type !== 'custom')
					throw new Error('Harness was not activated');
				harness_dir = (entry.data as { active_harness_dir: string })
					.active_harness_dir;
				const update_finished = new Promise<void>((resolve) => {
					session!.subscribe((event) => {
						if (
							event.type === 'tool_execution_end' &&
							event.toolName === 'harness_update'
						)
							resolve();
					});
				});
				const completion = await run_code(
					'complete-script',
					`return await tools.harness_update(${JSON.stringify({
						harness_dir,
						status: 'completed',
						evidence:
							'Self-reported success must not override execution',
					})});`,
					controller.signal,
				);
				// Cancellation can return before nested calls finish unwinding.
				await update_finished;
				const status = JSON.parse(
					readFileSync(join(harness_dir, 'status.json'), 'utf8'),
				) as HarnessStatusFile;
				expect(status.status).toBe(
					scenario === 'passed' ? 'completed' : 'failed',
				);
				const checks = status.log.at(-1)!.checks!;
				expect(checks).toHaveLength(scenario === 'passed' ? 2 : 1);
				expect(checks.every((check) => check.passed)).toBe(
					scenario === 'passed',
				);
				const update = calls.find(
					(call) => call.toolName === 'harness_update',
				)!;
				expect(update.parentToolCallId).toBe('complete-script');
				const bash_calls = calls.filter(
					(call) => call.toolName === 'bash',
				);
				expect(bash_calls).toHaveLength(
					scenario === 'passed' ? 2 : 1,
				);
				for (const call of bash_calls)
					expect(call.parentToolCallId).toBe(update.toolCallId);
				if (scenario === 'blocked')
					expect(
						readFileSync(checks[0]!.output_file, 'utf8'),
					).toContain('Validation permission denied');
				if (scenario !== 'cancelled')
					expect(JSON.stringify(completion.content)).toContain(
						scenario === 'passed'
							? 'Script completed'
							: 'Script failed',
					);
				expect(errors).toEqual([]);
			} finally {
				session?.dispose();
				if (harness_dir)
					rmSync(harness_dir, { recursive: true, force: true });
				rmSync(cwd, { recursive: true, force: true });
			}
		},
		20_000,
	);
});
