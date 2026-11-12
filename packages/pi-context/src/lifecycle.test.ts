import type { ImageContent } from '@earendil-works/pi-ai';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vite-plus/test';
import {
	capture_extension,
	hook_text,
	tool_result_event,
} from '../test/tool-fixtures.js';
import { register_context_lifecycle } from './lifecycle.js';
import {
	get_context_store,
	is_context_sidecar_enabled,
	set_context_sidecar_enabled,
} from './store.js';

const dirs: string[] = [];
const original_context_db = process.env.MY_PI_CONTEXT_DB;

function temp_db(): string {
	const dir = mkdtempSync(join(tmpdir(), 'pi-context-lifecycle-'));
	dirs.push(dir);

	return join(dir, 'context.db');
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
		const fake = capture_extension(register_context_lifecycle);

		expect(is_context_sidecar_enabled()).toBe(true);
		expect(fake.hook_count('session_start')).toBe(1);
		expect(fake.hook_count('session_shutdown')).toBe(1);
		expect(fake.hook_count('tool_result')).toBe(1);

		await fake.session_shutdown();
		expect(is_context_sidecar_enabled()).toBe(false);
	});

	it.each([
		['line', 'diagnostic detail\n'.repeat(400)],
		['byte', 'diagnostic detail '.repeat(2000)],
	])(
		'leaves failed results above the %s threshold unchanged',
		async (_limit, text) => {
			process.env.MY_PI_CONTEXT_DB = temp_db();
			const fake = capture_extension(register_context_lifecycle);

			const event = tool_result_event({
				toolName: 'bash',
				isError: true,
				content: [{ type: 'text', text: `failure-marker\n${text}` }],
			});

			const original = structuredClone(event);

			expect(await fake.tool_result(event)).toBeUndefined();
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
			const fake = capture_extension(register_context_lifecycle);

			const event = tool_result_event({
				toolName,
				parentToolCallId: 'script-1',
				content: [
					{ type: 'text', text: 'nested-marker\n'.repeat(400) },
				],
				structuredContent: {
					output: 'nested-marker\n'.repeat(400),
					truncated: false,
				},
			});

			const original = structuredClone(event);
			expect(await fake.tool_result(event)).toBeUndefined();
			expect(event).toEqual(original);
			expect(get_context_store().stats().sources).toBe(0);
		},
	);

	it('captures final codemode output and preserves images', async () => {
		process.env.MY_PI_CONTEXT_DB = temp_db();
		const fake = capture_extension(register_context_lifecycle);

		const image: ImageContent = {
			type: 'image',
			data: 'eA==',
			mimeType: 'image/png',
		};

		const result = await fake.tool_result(
			tool_result_event({
				toolName: 'codemode',
				content: [
					{ type: 'text', text: 'final-marker\n'.repeat(400) },
					image,
				],
			}),
		);

		expect(result?.content).toContainEqual(image);
		expect(
			get_context_store().search('final-marker', { global: true }),
		).not.toHaveLength(0);
	});

	it('indexes the complete native MCP text rather than its chat preview', async () => {
		process.env.MY_PI_CONTEXT_DB = temp_db();
		const fake = capture_extension(register_context_lifecycle);
		await fake.tool_result(
			tool_result_event({
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
			}),
		);
		expect(
			get_context_store().search('middle-marker', { global: true }),
		).toHaveLength(1);
	});

	it('redacts native structured output before persistence', async () => {
		process.env.MY_PI_CONTEXT_DB = temp_db();
		const fake = capture_extension(register_context_lifecycle);
		await fake.tool_result(
			tool_result_event({
				toolName: 'bash',
				content: [
					{ type: 'text', text: 'chat preview omits the middle' },
				],
				structuredContent: {
					output: `${'safe-marker\n'.repeat(400)}{"password":"synthetic-benchmark-secret"}`,
					truncated: false,
				},
			}),
		);
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
		const fake = capture_extension(register_context_lifecycle);
		await fake.session_start({
			cwd: '/repo',
			sessionManager: { getSessionId: () => 's1' },
		});

		expect(
			await fake.tool_result(
				tool_result_event({
					toolName: 'bash',
					content: [{ type: 'text', text: 'small' }],
				}),
			),
		).toBeUndefined();
		expect(
			await fake.tool_result(
				tool_result_event({
					toolName: 'context_search',
					content: [
						{
							type: 'text',
							text: `skip-token\n${'x\n'.repeat(400)}`,
						},
					],
				}),
			),
		).toBeUndefined();

		const replacement = await fake.tool_result(
			tool_result_event({
				toolName: 'bash',
				input: { command: 'generate' },
				content: [
					{
						type: 'text',
						text: `needle-token\n${'x\n'.repeat(400)}`,
					},
				],
			}),
			{ cwd: '/repo', sessionManager: { getSessionId: () => 's1' } },
		);

		expect(hook_text(replacement)).toContain('[context-sidecar]');
		expect(
			get_context_store().search('needle-token', { global: true }),
		).toHaveLength(1);

		const team_replacement = await fake.tool_result(
			tool_result_event({
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
			}),
			{ cwd: '/repo', sessionManager: { getSessionId: () => 's1' } },
		);

		expect(hook_text(team_replacement)).toContain(
			'[context-sidecar]',
		);
		expect(
			get_context_store().search('team-overflow-token', {
				global: true,
			}),
		).toHaveLength(1);
	});
});
