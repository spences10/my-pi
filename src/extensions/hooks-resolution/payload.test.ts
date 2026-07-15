import { describe, expect, it } from 'vitest';
import {
	build_hook_payload,
	matches_hook,
	to_claude_tool_name,
} from './payload.js';
import type { ResolvedCommandHook } from './types.js';

describe('src/extensions/hooks-resolution/payload.ts', () => {
	it('loads without side effects', async () => {
		await expect(import('./payload.js')).resolves.toBeDefined();
	});

	it('maps pi tool names to Claude hook tool names', () => {
		expect(to_claude_tool_name('ls')).toBe('LS');
		expect(to_claude_tool_name('bash')).toBe('Bash');
	});

	it('matches hooks against pi and Claude-style tool names', () => {
		const hook = { matcher: /Bash/ } as ResolvedCommandHook;
		expect(matches_hook(hook, 'bash')).toBe(true);
	});

	it('builds hook payloads with normalized file paths', () => {
		const payload = build_hook_payload(
			{
				toolName: 'read',
				toolCallId: 'call-1',
				input: { path: 'src/index.ts' },
			} as Parameters<typeof build_hook_payload>[0],
			'PreToolUse',
			{
				cwd: '/repo',
				sessionManager: {
					getSessionFile: () => '/tmp/session.jsonl',
				},
			} as Parameters<typeof build_hook_payload>[2],
			'/repo',
		);

		expect(payload).toMatchObject({
			tool_name: 'Read',
			tool_call_id: 'call-1',
		});
		expect(payload.tool_input).toMatchObject({
			file_path: 'src/index.ts',
			filePath: 'src/index.ts',
		});
	});
});
