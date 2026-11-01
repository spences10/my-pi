import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vite-plus/test';
import { register_context_lifecycle } from './lifecycle.js';
import {
	get_context_store,
	is_context_sidecar_enabled,
	set_context_sidecar_enabled,
} from './store.js';

type HookHandler = (
	event: unknown,
	ctx?: unknown,
) => Promise<unknown>;

const dirs: string[] = [];
const original_context_db = process.env.MY_PI_CONTEXT_DB;

function temp_db(): string {
	const dir = mkdtempSync(join(tmpdir(), 'pi-context-lifecycle-'));
	dirs.push(dir);
	return join(dir, 'context.db');
}

function fake_pi() {
	const hooks = new Map<string, HookHandler[]>();
	const pi = {
		on(name: string, handler: HookHandler) {
			hooks.set(name, [...(hooks.get(name) ?? []), handler]);
		},
	} as unknown as ExtensionAPI;
	return { pi, hooks };
}

afterEach(() => {
	set_context_sidecar_enabled(false);
	if (original_context_db === undefined)
		delete process.env.MY_PI_CONTEXT_DB;
	else process.env.MY_PI_CONTEXT_DB = original_context_db;
	for (const dir of dirs)
		rmSync(dir, { recursive: true, force: true });
	dirs.length = 0;
});

describe('register_context_lifecycle', () => {
	it('enables the sidecar and registers lifecycle hooks', async () => {
		process.env.MY_PI_CONTEXT_DB = temp_db();
		const { pi, hooks } = fake_pi();

		register_context_lifecycle(pi);

		expect(is_context_sidecar_enabled()).toBe(true);
		expect(hooks.get('session_start')).toHaveLength(1);
		expect(hooks.get('session_shutdown')).toHaveLength(1);
		expect(hooks.get('tool_result')).toHaveLength(1);

		await hooks.get('session_shutdown')![0]({}, {});
		expect(is_context_sidecar_enabled()).toBe(false);
	});

	it.each([
		['line', 'diagnostic detail\n'.repeat(400)],
		['byte', 'diagnostic detail '.repeat(2000)],
	])(
		'leaves failed results above the %s threshold unchanged',
		async (_limit, text) => {
			process.env.MY_PI_CONTEXT_DB = temp_db();
			const { pi, hooks } = fake_pi();
			register_context_lifecycle(pi);
			const event = {
				toolName: 'bash',
				isError: true,
				content: [{ type: 'text', text: `failure-marker\n${text}` }],
			};
			const original = structuredClone(event);

			expect(
				await hooks.get('tool_result')![0](event),
			).toBeUndefined();
			expect(event).toEqual(original);
			expect(
				get_context_store().search('failure-marker', {
					global: true,
				}),
			).toHaveLength(0);
		},
	);

	it.each(['bash', 'read', 'mcp__docs__extract', 'codemode'])(
		'leaves nested %s output intact without indexing it',
		async (toolName) => {
			process.env.MY_PI_CONTEXT_DB = temp_db();
			const { pi, hooks } = fake_pi();
			register_context_lifecycle(pi);
			const event = {
				toolName,
				parentToolCallId: 'script-1',
				content: [
					{ type: 'text', text: 'nested-marker\n'.repeat(400) },
				],
				structuredContent: {
					output: 'nested-marker\n'.repeat(400),
					truncated: false,
				},
			};
			const original = structuredClone(event);
			expect(
				await hooks.get('tool_result')![0](event),
			).toBeUndefined();
			expect(event).toEqual(original);
			expect(get_context_store().stats().sources).toBe(0);
		},
	);

	it('captures final codemode output and preserves images', async () => {
		process.env.MY_PI_CONTEXT_DB = temp_db();
		const { pi, hooks } = fake_pi();
		register_context_lifecycle(pi);
		const image = {
			type: 'image',
			data: 'eA==',
			mimeType: 'image/png',
		};
		const result = (await hooks.get('tool_result')![0]({
			toolName: 'codemode',
			content: [
				{ type: 'text', text: 'final-marker\n'.repeat(400) },
				image,
			],
		})) as { content: unknown[] };
		expect(result.content).toContainEqual(image);
		expect(
			get_context_store().search('final-marker', { global: true }),
		).not.toHaveLength(0);
	});

	it('indexes the complete native MCP text rather than its chat preview', async () => {
		process.env.MY_PI_CONTEXT_DB = temp_db();
		const { pi, hooks } = fake_pi();
		register_context_lifecycle(pi);
		await hooks.get('tool_result')![0]({
			toolName: 'mcp__docs__extract',
			content: [{ type: 'text', text: 'truncated preview' }],
			structuredContent: {
				content: [
					{
						type: 'text',
						text: `${'raw content\n'.repeat(400)}middle-marker`,
					},
				],
			},
		});
		expect(
			get_context_store().search('middle-marker', { global: true }),
		).toHaveLength(1);
	});

	it('redacts native structured output before persistence', async () => {
		process.env.MY_PI_CONTEXT_DB = temp_db();
		const { pi, hooks } = fake_pi();
		register_context_lifecycle(pi);
		await hooks.get('tool_result')![0]({
			toolName: 'bash',
			content: [
				{ type: 'text', text: 'chat preview omits the middle' },
			],
			structuredContent: {
				output: `${'safe-marker\n'.repeat(400)}{"password":"synthetic-benchmark-secret"}`,
				truncated: false,
			},
		});
		const store = get_context_store();
		const source = store.list({ global: true })[0]!;
		const text = store.export_content(source.source_id, undefined, {
			global: true,
		}).content;
		expect(text).toContain('[REDACTED:');
		expect(text).not.toContain('synthetic-benchmark-secret');
	});

	it('indexes only oversized text tool results for the active scope', async () => {
		process.env.MY_PI_CONTEXT_DB = temp_db();
		const { pi, hooks } = fake_pi();
		register_context_lifecycle(pi);
		await hooks.get('session_start')![0](
			{},
			{ cwd: '/repo', sessionManager: { getSessionId: () => 's1' } },
		);
		const tool_result = hooks.get('tool_result')![0];

		expect(
			await tool_result({
				toolName: 'bash',
				content: [{ type: 'text', text: 'small' }],
			}),
		).toBeUndefined();
		expect(
			await tool_result({
				toolName: 'context_search',
				content: [
					{ type: 'text', text: `skip-token\n${'x\n'.repeat(400)}` },
				],
			}),
		).toBeUndefined();

		const replacement = (await tool_result(
			{
				toolName: 'bash',
				input: { command: 'generate' },
				content: [
					{
						type: 'text',
						text: `needle-token\n${'x\n'.repeat(400)}`,
					},
				],
			},
			{ cwd: '/repo', sessionManager: { getSessionId: () => 's1' } },
		)) as { content: Array<{ text: string }> };

		expect(replacement.content[0].text).toContain(
			'[context-sidecar]',
		);
		expect(
			get_context_store().search('needle-token', { global: true }),
		).toHaveLength(1);

		const team_replacement = (await tool_result(
			{
				toolName: 'team',
				isError: false,
				input: {
					action: 'session_inbox',
					include_read: true,
					mode: 'full',
					limit: 20,
				},
				content: [
					{
						type: 'text',
						text: `team-overflow-token\n${'historical message\n'.repeat(400)}`,
					},
				],
			},
			{ cwd: '/repo', sessionManager: { getSessionId: () => 's1' } },
		)) as { content: Array<{ text: string }> };

		expect(team_replacement.content[0].text).toContain(
			'[context-sidecar]',
		);
		expect(
			get_context_store().search('team-overflow-token', {
				global: true,
			}),
		).toHaveLength(1);
	});
});
