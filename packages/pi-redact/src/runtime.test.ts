import {
	fauxAssistantMessage,
	fauxProvider,
	type TranscriptContext,
} from '@earendil-works/pi-ai';
import {
	createAgentSession,
	createEventBus,
	DefaultResourceLoader,
	ModelRuntime,
	SessionManager,
	SettingsManager,
	type ExtensionFactory,
} from '@earendil-works/pi-coding-agent';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vite-plus/test';
import { make_assistant_message } from '../../../tools/test-sdk.js';
import filter_output from './index.js';

const token = `ghp_${'T'.repeat(36)}`;

async function with_runtime(
	run: (
		fixture: Awaited<ReturnType<typeof create_runtime>>,
	) => Promise<void>,
	extensions_before: ExtensionFactory[] = [],
) {
	const fixture = await create_runtime(extensions_before);

	try {
		await run(fixture);
		expect(fixture.errors).toEqual([]);
	} finally {
		fixture.session.dispose();
		await rm(fixture.dir, { recursive: true, force: true });
	}
}

async function create_runtime(
	extensions_before: ExtensionFactory[] = [],
) {
	const dir = await mkdtemp(join(tmpdir(), 'pi-redact-sdk-'));

	const settings = SettingsManager.inMemory({
		compaction: {
			enabled: false,
			keepRecentTokens: 16,
			reserveTokens: 1024,
		},
		retry: { enabled: false },
	});

	const runtime = await ModelRuntime.create({
		authPath: join(dir, 'auth.json'),
		modelsPath: null,
		modelsStorePath: join(dir, 'models.json'),
		allowModelNetwork: false,
		refreshOnCreate: false,
	});

	const faux = fauxProvider({
		provider: 'redact-offline',
		tokensPerSecond: 1_000_000,
	});

	runtime.registerNativeProvider(faux.provider);
	const contexts: TranscriptContext[] = [];
	faux.setResponses(
		Array.from({ length: 10 }, () => (context: TranscriptContext) => {
			contexts.push(structuredClone(context));

			return fauxAssistantMessage('Offline response and summary.');
		}),
	);
	const events = createEventBus();

	const loader = new DefaultResourceLoader({
		cwd: dir,
		agentDir: dir,
		settingsManager: settings,
		eventBus: events,
		noExtensions: true,
		noSkills: true,
		noThemes: true,
		noPromptTemplates: true,
		noContextFiles: true,
		systemPrompt: 'Offline redaction regression.',
		extensionFactories: [...extensions_before, filter_output],
	});

	await loader.reload();
	const manager = SessionManager.inMemory(dir);

	const { session } = await createAgentSession({
		cwd: dir,
		agentDir: dir,
		modelRuntime: runtime,
		model: faux.getModel(),
		resourceLoader: loader,
		sessionManager: manager,
		settingsManager: settings,
		tools: [],
		thinkingLevel: 'off',
	});

	const errors: string[] = [];
	await session.bindExtensions({
		onError: (error) => errors.push(error.error),
	});

	return { dir, session, manager, contexts, errors, events };
}

describe('actual offline SDK transport', () => {
	it('honors an earlier blocking user_bash handler instead of replacing its decision', async () => {
		const blocked = {
			output: 'Command denied by an earlier safety handler.',
			exitCode: 1,
			cancelled: false,
			truncated: false,
		};

		await with_runtime(
			async ({ session, dir }) => {
				const result = await session.extensionRunner.emitUserBash({
					type: 'user_bash',
					command: 'must not execute',
					cwd: dir,
					excludeFromContext: false,
				});

				expect(result).toEqual({ result: blocked });
				expect(result?.operations).toBeUndefined();
			},
			[
				(pi) => {
					pi.on('user_bash', () => ({ result: blocked }));
				},
			],
		);
	});

	it('masks delivered user/custom messages before persistence and provider requests', async () => {
		await with_runtime(
			async ({ session, manager, contexts, events }) => {
				const registered = 'opaque runtime registration fixture';
				events.emit('pi-redact:register-secrets', {
					values: [registered],
				});
				await session.prompt(`Review ${token} and ${registered}`);
				await session.sendCustomMessage(
					{ customType: 'test', content: token, display: false },
					{ triggerTurn: true },
				);
				expect(contexts.length).toBe(2);
				expect(JSON.stringify(contexts)).not.toContain(token);
				expect(JSON.stringify(contexts)).not.toContain(registered);
				expect(JSON.stringify(manager.getEntries())).not.toContain(
					token,
				);
				expect(JSON.stringify(manager.getEntries())).not.toContain(
					registered,
				);
			},
		);
	});

	it('forwards safe progress before the actual shell process can finish', async () => {
		await with_runtime(async ({ session, manager, dir }) => {
			const barrier = join(dir, 'progress-received');
			const script = `const fs = require('node:fs'); process.stdout.write('ready\\n'); const timer = setInterval(() => { if (fs.existsSync(${JSON.stringify(barrier)})) { clearInterval(timer); process.stdout.write('ghp_' + 'T'.repeat(36) + '\\ndone\\n'); } }, 10); setTimeout(() => process.exit(75), 2000).unref();`;
			const command = 'node -e ' + JSON.stringify(script);

			const handled = await session.extensionRunner.emitUserBash({
				type: 'user_bash',
				command,
				cwd: dir,
				excludeFromContext: false,
			});

			const chunks: string[] = [];

			const result = await session.executeBash(
				command,
				(chunk) => {
					chunks.push(chunk);

					if (chunk.includes('ready\n'))
						writeFileSync(barrier, 'received');
				},
				{ operations: handled?.operations },
			);

			expect(result.exitCode).toBe(0);
			expect(chunks[0]).toBe('ready\n');
			expect(chunks.join('')).toContain('done\n');
			expect(chunks.join('')).not.toContain(token);
			expect(JSON.stringify(manager.getEntries())).not.toContain(
				token,
			);
		});
	});

	it('sanitizes direct shell output before callbacks, session storage and truncation files', async () => {
		await with_runtime(async ({ session, manager, dir }) => {
			const command = `printf 'ghp_'; printf '%s\\n' '${'T'.repeat(36)}'; node -e 'process.stdout.write("safe line\\n".repeat(7000))'`;

			const handled = await session.extensionRunner.emitUserBash({
				type: 'user_bash',
				command,
				cwd: dir,
				excludeFromContext: false,
			});

			expect(handled?.operations).toBeDefined();
			const chunks: string[] = [];

			const result = await session.executeBash(
				command,
				(chunk) => chunks.push(chunk),
				{ operations: handled?.operations },
			);

			expect(result.exitCode).toBe(0);
			expect(result.cancelled).toBe(false);
			expect(result.truncated).toBe(true);
			expect(chunks.join('')).not.toContain(token);
			expect(JSON.stringify(manager.getEntries())).not.toContain(
				token,
			);
			expect(result.fullOutputPath).toBeDefined();

			if (result.fullOutputPath) {
				try {
					const path = result.fullOutputPath;
					await expect
						.poll(() => readFile(path, 'utf8'))
						.toBe(chunks.join(''));
					expect(await readFile(path, 'utf8')).not.toContain(token);
				} finally {
					await rm(result.fullOutputPath, { force: true });
				}
			}
		});
	});

	it('sanitizes old raw history for default compaction without rewriting saved entries', async () => {
		await with_runtime(async ({ session, manager, contexts }) => {
			session.recordBashResult('old shell command', {
				output: token,
				exitCode: 0,
				cancelled: false,
				truncated: false,
			});
			await session.sendCustomMessage(
				{ customType: 'old-custom', content: token, display: false },
				{ triggerTurn: false },
			);
			await session.prompt(
				'Review the old history and describe the result.',
			);
			const before = contexts.length;
			await session.compact();
			expect(contexts.length).toBeGreaterThan(before);
			expect(JSON.stringify(contexts.slice(before))).not.toContain(
				token,
			);
			expect(JSON.stringify(manager.getEntries())).toContain(token);
			expect(
				manager
					.getEntries()
					.find((entry) => entry.type === 'compaction'),
			).toMatchObject({ fromHook: false });
		});
	});

	it('sanitizes the retained entries array for default tree summaries without changing raw entries', async () => {
		await with_runtime(async ({ session, manager, contexts }) => {
			manager.appendMessage({
				role: 'user',
				content: 'Root task',
				timestamp: 1,
			});

			const target = manager.appendMessage(
				make_assistant_message({
					content: [{ type: 'text', text: 'Root response' }],
				}),
			);

			session.recordBashResult('old shell command', {
				output: token,
				exitCode: 0,
				cancelled: false,
				truncated: false,
			});
			await session.prompt('Continue this branch.');
			const before = contexts.length;

			const result = await session.navigateTree(target, {
				summarize: true,
			});

			expect(result.cancelled).not.toBe(true);
			expect(contexts.length).toBeGreaterThan(before);
			expect(JSON.stringify(contexts.slice(before))).not.toContain(
				token,
			);
			expect(JSON.stringify(manager.getEntries())).toContain(token);
			expect(
				manager
					.getEntries()
					.find((entry) => entry.type === 'branch_summary'),
			).toMatchObject({ fromHook: false });
		});
	});
});
