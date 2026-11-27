import type {
	ContextEvent,
	ContextEventResult,
	ContextWithSystemEvent,
	ExtensionHandler,
	MessageEndEvent,
	MessageEndEventResult,
	ToolCallEvent,
	ToolCallEventResult,
	ToolResultEvent,
	ToolResultEventResult,
} from '@earendil-works/pi-coding-agent';
import {
	mkdir,
	mkdtemp,
	rm,
	symlink,
	writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import {
	make_api,
	make_assistant_message,
	make_command_context,
	make_context,
	make_ui,
} from '../../../tools/test-sdk.js';
import filter_output, { redact_text } from './index.js';

const token = `ghp_${'S'.repeat(36)}`;
const opaque = 'a synthetic unshaped credential';
const folders: string[] = [];

afterEach(async () => {
	await Promise.all(
		folders
			.splice(0)
			.map((path) => rm(path, { recursive: true, force: true })),
	);
});

async function fixture_file(text: string, name = 'fixture.txt') {
	const dir = await mkdtemp(join(tmpdir(), 'pi-redact-hooks-'));
	folders.push(dir);
	const path = join(dir, name);
	await writeFile(path, text);

	return { dir, path };
}

function capture_redaction() {
	const hooks = new Map<string, Function>();

	const pi = make_api({
		on(name: string, handler: Function) {
			hooks.set(name, handler);

			return () => hooks.delete(name);
		},
	});

	const commands = vi.spyOn(pi, 'registerCommand');
	filter_output(pi);

	async function invoke<E extends { type: string }, R>(event: E) {
		// SAFETY: the fixture stores handlers only from ExtensionAPI.on registrations.
		const hook = hooks.get(event.type) as ExtensionHandler<E, R>;

		return hook(event, make_context());
	}

	return {
		pi,
		result: (event: Partial<ToolResultEvent> = {}) =>
			invoke<ToolResultEvent, ToolResultEventResult>({
				type: 'tool_result',
				toolName: 'test',
				toolCallId: 'call',
				input: {},
				content: [{ type: 'text', text: token }],
				details: undefined,
				isError: false,
				...event,
			}),
		context_with_system: (messages: ContextEvent['messages']) =>
			invoke<ContextWithSystemEvent, ContextEventResult>({
				type: 'context_with_system',
				messages,
			}),
		message: (message: MessageEndEvent['message']) =>
			invoke<MessageEndEvent, MessageEndEventResult>({
				type: 'message_end',
				message,
			}),
		call: (event: ToolCallEvent) =>
			invoke<ToolCallEvent, ToolCallEventResult>(event),
		shutdown: () =>
			invoke({ type: 'session_shutdown', reason: 'quit' }),
		start: () => invoke({ type: 'session_start' }),
		handlers: () => [...hooks.keys()],
		async stats() {
			const notify = vi.fn();
			await commands.mock.calls
				.find(([name]) => name === 'redact-stats')?.[1]
				.handler(
					'',
					make_command_context({ ui: make_ui({ notify }) }),
				);

			return notify.mock.calls[0]?.[0];
		},
	};
}

function text_of(result: ToolResultEventResult | void) {
	return result?.content
		?.flatMap((block) => (block.type === 'text' ? [block.text] : []))
		.join('');
}

describe('redaction hooks', () => {
	it('preserves structured output and details while masking string leaves and split blocks', async () => {
		const redact = capture_redaction();
		redact.pi.events.emit('pi-redact:register-secrets', {
			values: [opaque],
		});

		const image = {
			type: 'image' as const,
			data: token,
			mimeType: 'image/png',
		};

		const result = await redact.result({
			content: [
				{ type: 'text', text: token.slice(0, 12) },
				{ type: 'text', text: token.slice(12) },
				image,
			],
			details: {
				label: token,
				count: 2,
				nested: [false, null, opaque],
			},
			structuredContent: {
				content: [
					{ type: 'text', text: token.slice(0, 20) },
					{ type: 'text', text: token.slice(20) },
				],
				password: 'synthetic-password-value',
				count: 3,
				image,
			},
		});

		expect(text_of(result)).not.toContain(token);
		expect(result?.content?.[2]).toEqual(image);
		expect(result?.structuredContent).toMatchObject({
			count: 3,
			image,
		});
		expect(JSON.stringify(result?.details)).not.toContain(token);
		expect(JSON.stringify(result?.details)).not.toContain(opaque);
		expect(result?.details).toMatchObject({
			count: 2,
			nested: [false, null, expect.stringContaining('[REDACTED:')],
		});
		expect(JSON.stringify(result?.structuredContent)).not.toContain(
			'synthetic-password-value',
		);
	});

	it('registers explicitly, validates messages, invalidates cloned-context cache and cleans up', async () => {
		const redact = capture_redaction();
		const other = capture_redaction();

		const message = {
			role: 'user' as const,
			content: opaque,
			timestamp: 1,
		};

		expect(
			await redact.context_with_system([message]),
		).toBeUndefined();
		redact.pi.events.emit('pi-redact:register-secrets', {
			values: [opaque, 123],
		});
		expect(
			await redact.context_with_system([message]),
		).toBeUndefined();
		redact.pi.events.emit('pi-redact:register-secrets', {
			values: ['', opaque],
		});
		expect(
			JSON.stringify(
				await redact.context_with_system(structuredClone([message])),
			),
		).not.toContain(opaque);
		const first = await redact.stats();
		await redact.context_with_system(structuredClone([message]));
		expect(await redact.stats()).toEqual(first);
		expect(
			await other.context_with_system([message]),
		).toBeUndefined();
		await redact.shutdown();
		redact.pi.events.emit('pi-redact:register-secrets', {
			values: [opaque],
		});
		expect(
			await redact.context_with_system([message]),
		).toBeUndefined();
		await redact.start();
		redact.pi.events.emit('pi-redact:register-secrets', {
			values: [opaque],
		});
		expect(
			JSON.stringify(await redact.context_with_system([message])),
		).not.toContain(opaque);
	});

	it('redacts request copies only in context_with_system so Pi never collapses its system messages', async () => {
		const redact = capture_redaction();

		// Pi replays every system message as one leading head whenever a `context` handler returns a changed list,
		// so tools loaded later by `tool_search` would rewrite the head and miss the prompt cache.
		expect(redact.handlers()).toContain('context_with_system');
		expect(redact.handlers()).not.toContain('context');
	});

	it('leaves a conversation without secrets alone so Pi keeps its system messages in place', async () => {
		const redact = capture_redaction();

		const messages: ContextEvent['messages'] = [
			{
				role: 'system',
				content: 'base prompt',
				sections: { rules: 'be brief' },
				toolsAdded: [],
				timestamp: 0,
			},
			{ role: 'user', content: 'hello', timestamp: 1 },
			{
				role: 'system',
				content: '',
				toolsAdded: [],
				timestamp: 2,
			},
			{
				role: 'toolResult',
				toolCallId: 'call',
				toolName: 'tool_search',
				content: [{ type: 'text', text: 'Loaded 2 tools.' }],
				isError: false,
				timestamp: 3,
			},
		];

		expect(
			await redact.context_with_system(messages),
		).toBeUndefined();
	});

	it('keeps untouched messages, including system messages, by identity and replaces only the ones it redacted', async () => {
		const redact = capture_redaction();

		const system = {
			role: 'system' as const,
			content: 'base prompt',
			sections: { rules: 'be brief' },
			toolsAdded: [],
			timestamp: 0,
		};

		const loaded = {
			role: 'system' as const,
			content: '',
			toolsAdded: [],
			timestamp: 2,
		};

		const clean = {
			role: 'user' as const,
			content: 'hello',
			timestamp: 1,
		};

		const secret = {
			role: 'user' as const,
			content: token,
			timestamp: 3,
		};

		const result = await redact.context_with_system([
			system,
			clean,
			loaded,
			secret,
		]);

		expect(result?.messages?.[0]).toBe(system);
		expect(result?.messages?.[1]).toBe(clean);
		expect(result?.messages?.[2]).toBe(loaded);
		expect(result?.messages?.[3]).not.toBe(secret);
		expect(JSON.stringify(result?.messages?.[3])).not.toContain(
			token,
		);
	});

	it('masks finalized user/custom text but does not alter executable tool arguments or metadata', async () => {
		const redact = capture_redaction();

		for (const message of [
			{ role: 'user' as const, content: token, timestamp: 1 },
			{
				role: 'custom' as const,
				content: token,
				customType: 'test',
				display: false,
				timestamp: 1,
			},
		])
			expect(
				JSON.stringify(await redact.message(message)),
			).not.toContain(token);

		const assistant = make_assistant_message({
			content: [
				{
					type: 'toolCall',
					id: token,
					name: 'bash',
					arguments: { command: `printf '${token}'` },
				},
				{ type: 'text', text: token },
			],
		});

		const finalized = (await redact.message(assistant))?.message;
		expect(finalized?.role).toBe('assistant');
		expect(
			finalized?.role === 'assistant' && finalized.content[0],
		).toEqual(assistant.content[0]);

		const fallback = (await redact.context_with_system([assistant]))
			?.messages?.[0];

		expect(
			fallback?.role === 'assistant' && fallback.content[0],
		).toMatchObject({
			id: token,
			name: 'bash',
			arguments: { command: expect.not.stringContaining(token) },
		});
		expect(assistant.content[1]).toEqual({
			type: 'text',
			text: token,
		});
	});

	it('masks old bash commands, output and summaries without changing raw history', async () => {
		const redact = capture_redaction();

		const messages: ContextEvent['messages'] = [
			{
				role: 'bashExecution',
				command: `echo ${token}`,
				output: token,
				timestamp: 1,
				exitCode: 0,
				cancelled: false,
				truncated: false,
			},
			{
				role: 'compactionSummary',
				summary: token,
				tokensBefore: 4,
				timestamp: 2,
			},
			{
				role: 'branchSummary',
				summary: token,
				fromId: 'parent',
				timestamp: 3,
			},
		];

		expect(
			JSON.stringify(await redact.context_with_system(messages)),
		).not.toContain(token);
		expect(JSON.stringify(messages)).toContain(token);
	});
});

describe('masked read safety', () => {
	it('blocks a genuine key source at arbitrary offsets and through symlink aliases', async () => {
		const payload = 'YWJj'.repeat(24);

		const { path, dir } = await fixture_file(
			`-----${'BEGIN PRIVATE KEY-----'}\n${payload}\n-----${'END PRIVATE KEY-----'}\nordinary text`,
		);

		const alias = join(dir, 'alias');
		await symlink(path, alias);
		const redact = capture_redaction();

		for (const input of [
			{ path, offset: 2 },
			{ path: alias, offset: 3 },
			{ path, offset: 1 },
		]) {
			expect(
				await redact.call({
					type: 'tool_call',
					toolName: 'read',
					toolCallId: 'read',
					input,
				}),
			).toMatchObject({ block: true });
		}
	});

	it('does not poison unrelated read offsets, replacement files or marker examples', async () => {
		const { path } = await fixture_file('Documentation');
		const redact = capture_redaction();

		const result = (text: string, offset = 1) =>
			redact.result({
				toolName: 'read',
				input: { path, offset },
				content: [{ type: 'text', text }],
			});

		await result(
			'Docs show -----BEGIN PRIVATE KEY----- as a marker.',
		);
		expect(text_of(await result('ordinary documentation', 2))).toBe(
			'ordinary documentation',
		);
		await result('-----BEGIN PRIVATE KEY-----');
		const base64 = 'YWJj'.repeat(24);
		expect(text_of(await result(base64, 20))).toBe(base64);
		await result('-----BEGIN PRIVATE KEY-----');
		await writeFile(path, 'New content changes the source identity');
		expect(text_of(await result(base64, 2))).toBe(base64);
	});

	it('blocks copying introduced markers only into the previously masked file', async () => {
		const { path, dir } = await fixture_file(token);
		const redact = capture_redaction();

		const content =
			text_of(
				await redact.result({
					toolName: 'read',
					input: { path },
					content: [{ type: 'text', text: token }],
				}),
			) ?? '';

		const write = (target: string) =>
			redact.call({
				type: 'tool_call',
				toolName: 'write',
				toolCallId: 'write',
				input: { path: target, content },
			});

		expect(await write(path)).toMatchObject({ block: true });
		await redact.result({
			toolName: 'read',
			input: { path, offset: 2 },
			content: [{ type: 'text', text: `npm_${'N'.repeat(36)}` }],
		});
		// A later marker family must not forget the earlier masked view.
		expect(await write(path)).toMatchObject({ block: true });
		expect(await write(join(dir, 'new-docs.md'))).toBeUndefined();
		await writeFile(path, content);
		expect(await write(path)).toBeUndefined();
		await rm(path);
		await mkdir(path);
		expect(await write(path)).toMatchObject({ block: true });
	});

	it('retains standalone helper exports', () => {
		expect(redact_text(token).redacted).not.toContain(token);
		expect(
			redact_text(opaque, { known_values: [opaque] }).redacted,
		).not.toContain(opaque);
	});
});
