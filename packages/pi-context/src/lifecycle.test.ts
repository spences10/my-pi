import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
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
	});
});
