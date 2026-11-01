import {
	fauxAssistantMessage,
	fauxProvider,
	type TranscriptContext,
} from '@earendil-works/pi-ai';
import {
	createAgentSession,
	DefaultResourceLoader,
	ModelRuntime,
	SessionManager,
	SettingsManager,
} from '@earendil-works/pi-coding-agent';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { TeamDatabase } from './db/index.js';
import team_mode from './index.js';

vi.mock('./coordination-broker.js', () => ({
	ensure_coordination_broker: vi.fn(async () => {}),
	CoordinationBrokerClient: class {
		start() {}
		stop() {}
		async notify_messages() {}
	},
}));

afterEach(() => vi.unstubAllEnvs());

describe('real upstream runtime delivery', () => {
	it.each(['action', 'status'] as const)(
		'persists %s messages through the real runtime without an extra external wake-up',
		async (message_type) => {
			const dir = mkdtempSync(join(tmpdir(), 'team-upstream-'));
			const path = join(dir, 'coordination.db');
			vi.stubEnv('MY_PI_COORDINATION_DB', path);
			vi.stubEnv('MY_PI_TEAM_AUTO_INJECT_MESSAGES', 'true');
			const db = await TeamDatabase.open(path);
			const sessionManager = SessionManager.inMemory(dir);
			const receiver = sessionManager.getSessionId();
			db.register_session({ session_id: 'sender', cwd: dir });
			const settingsManager = SettingsManager.inMemory({
				compaction: { enabled: false },
				retry: { enabled: false },
			});
			const faux = fauxProvider({
				provider: 'team-test',
				tokensPerSecond: 1_000_000,
			});
			const modelRuntime = await ModelRuntime.create({
				authPath: join(dir, 'auth.json'),
				modelsPath: null,
				modelsStorePath: join(dir, 'models-cache.json'),
				refreshOnCreate: false,
			});
			modelRuntime.registerNativeProvider(faux.provider);
			const contexts: TranscriptContext[] = [];
			faux.setResponses([
				(context) => {
					contexts.push(context);
					db.send_message({
						from_session_id: 'sender',
						to_session_ids: [receiver],
						scope: 'session',
						target: receiver,
						body: 'Review the completed build',
						message_type,
					});
					return fauxAssistantMessage('Initial work finished.');
				},
				(context) => {
					contexts.push(context);
					return fauxAssistantMessage('Peer review processed.');
				},
			]);
			const boundaries: unknown[] = [];
			const resourceLoader = new DefaultResourceLoader({
				cwd: dir,
				agentDir: dir,
				settingsManager,
				noExtensions: true,
				noSkills: true,
				noThemes: true,
				noPromptTemplates: true,
				noContextFiles: true,
				extensionFactories: [
					team_mode,
					(pi) => {
						pi.on('before_agent_start', (event) => {
							boundaries.push({
								type: 'start',
								selected: event.systemPromptOptions.selectedTools,
							});
						});
						pi.on('agent_before_settle', (event) => {
							boundaries.push({
								type: 'settle',
								outcome: event.outcome,
								entries: event.entries.length,
								continue: event.continue,
							});
						});
					},
				],
			});
			await resourceLoader.reload();
			const errors: unknown[] = [];
			const { session } = await createAgentSession({
				cwd: dir,
				agentDir: dir,
				model: faux.getModel(),
				modelRuntime,
				sessionManager,
				settingsManager,
				resourceLoader,
				tools: ['team'],
				thinkingLevel: 'off',
			});
			try {
				await session.bindExtensions({
					onError: (error) => errors.push(error),
				});
				session.setActiveToolsByName(['team']);
				await session.prompt('Perform the authorized task.');
				await session.waitForIdle();
				if (message_type === 'status') {
					expect(faux.state.callCount).toBe(1);
					expect(
						db.list_inbox(receiver)[0]?.delivered_at,
					).toBeUndefined();
					await session.prompt(
						'Continue with the next authorized task.',
					);
				}
				expect(errors).toEqual([]);
				expect(faux.state.callCount).toBe(2);
				expect(boundaries).toContainEqual({
					type: 'settle',
					outcome: 'completed',
					entries: message_type === 'action' ? 1 : 0,
					continue: message_type === 'action',
				});
				expect(JSON.stringify(contexts[1]?.messages)).toContain(
					'Review the completed build',
				);
				expect(
					sessionManager
						.getBranch()
						.filter((entry) => entry.type === 'custom_message'),
				).toHaveLength(1);
				const receipt = db.list_inbox(receiver, {
					include_read: true,
				})[0]!;
				expect(receipt.delivered_at).toBeDefined();
				expect(receipt.read_at).toBeUndefined();
			} finally {
				session.dispose();
				db.close();
				rmSync(dir, { recursive: true, force: true });
			}
		},
		15_000,
	);
});
