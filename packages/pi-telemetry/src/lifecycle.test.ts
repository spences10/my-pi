import {
	createFauxCore,
	fauxAssistantMessage,
	fauxToolCall,
} from '@earendil-works/pi-ai';
import {
	createAgentSession,
	createCodemodeExtension,
	DefaultResourceLoader,
	ModelRuntime,
	SessionManager,
	SettingsManager,
} from '@earendil-works/pi-coding-agent';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vite-plus/test';
import { load_telemetry_config } from './config.js';
import { TelemetryDatabase, type TelemetryRunSummary } from './db.js';
import { create_telemetry_extension } from './index.js';

// Real Pi turns and nested tool execution, with deterministic local model replies.
describe('native Pi telemetry lifecycle', () => {
	it.each(['direct', 'codemode'] as const)(
		'finishes task recording before review through %s',
		async (mode) => {
			const cwd = mkdtempSync(
				join(tmpdir(), 'pi-telemetry-lifecycle-'),
			);
			vi.stubEnv('PI_CODING_AGENT_DIR', cwd);
			vi.stubEnv('PI_OFFLINE', '1');
			const db_path = join(cwd, 'telemetry.db');
			let session:
				| Awaited<ReturnType<typeof createAgentSession>>['session']
				| undefined;
			let database: TelemetryDatabase | undefined;
			try {
				const core = createFauxCore({
					provider: 'telemetry-test',
					api: 'telemetry-test',
					models: [{ id: 'test' }],
					tokensPerSecond: 1000000,
				});
				const task = {
					eval_suite: 'repeatable',
					eval_case_id: 'check-links',
				};
				const call = (action: string) =>
					fauxAssistantMessage(
						mode === 'direct'
							? fauxToolCall('telemetry', { action, cwd, ...task })
							: fauxToolCall('codemode', {
									code: `return await tools.telemetry(${JSON.stringify({ action, cwd, ...task })});`,
								}),
						{ stopReason: 'toolUse' },
					);
				core.setResponses([
					call('on'),
					call('query'),
					call('off'),
					call('query'),
					fauxAssistantMessage('Reviewed the completed recording.'),
				]);
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
				const snapshots: Array<{
					active_run_id: string | null;
					stop_pending: boolean;
					runs: TelemetryRunSummary[];
				}> = [];
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
						create_telemetry_extension({ db_path }),
						...(mode === 'codemode'
							? [createCodemodeExtension({ mode: 'only' })]
							: []),
						(pi) => {
							pi.registerProvider('telemetry-test', {
								api: core.api,
								apiKey: 'test',
								baseUrl: 'http://unused.invalid',
								models: core.models,
								streamSimple: core.streamSimple,
							});
							const query_ids = new Set<string>();
							pi.on('tool_execution_start', (event) => {
								if (
									event.toolName === 'telemetry' &&
									event.args.action === 'query'
								) {
									query_ids.add(event.toolCallId);
								}
							});
							pi.on('tool_execution_end', (event) => {
								if (!query_ids.has(event.toolCallId)) return;
								const result = event.result as {
									content: Array<{ text: string }>;
								};
								snapshots.push(JSON.parse(result.content[0]!.text));
							});
						},
					],
				});
				await loader.reload();
				({ session } = await createAgentSession({
					cwd,
					agentDir: cwd,
					modelRuntime: runtime,
					model: core.getModel(),
					settingsManager: settings,
					sessionManager: SessionManager.create(
						cwd,
						join(cwd, 'sessions'),
					),
					resourceLoader: loader,
					tools:
						mode === 'direct'
							? ['telemetry']
							: ['telemetry', 'codemode'],
				}));
				const errors: unknown[] = [];
				await session.bindExtensions({
					onError: (error) => errors.push(error),
				});
				await session.prompt('Record a task, stop, then review it.');
				expect(errors).toEqual([]);
				expect(core.getPendingResponseCount()).toBe(0);
				expect(snapshots).toHaveLength(2);
				const [live, completed] = snapshots;
				expect(live!.active_run_id).toBe(live!.runs[0]!.id);
				expect(live!.runs[0]).toMatchObject({
					duration_ms: null,
					ended_at: null,
				});
				expect(completed!.active_run_id).toBeNull();
				expect(completed!.stop_pending).toBe(false);
				expect(completed!.runs).toHaveLength(1);
				expect(completed!.runs[0]).toMatchObject({
					...task,
					cwd,
					session_file: session.sessionFile,
					duration_ms: expect.any(Number),
					ended_at: expect.any(Number),
					success: null,
					error_message: null,
					turn_count: 3,
					tool_call_count: mode === 'direct' ? 2 : 4,
				});
				database = await TelemetryDatabase.open(db_path);
				for (const table of ['turns', 'tool_calls']) {
					expect(
						database.read_rows(
							`SELECT * FROM ${table} WHERE ended_at IS NULL`,
						),
					).toEqual([]);
				}
				expect(database.query_runs()).toHaveLength(1);
				expect(load_telemetry_config().enabled).toBe(false);
			} finally {
				session?.dispose();
				database?.close();
				vi.unstubAllEnvs();
				rmSync(cwd, { recursive: true, force: true });
			}
		},
		20_000,
	);
});
