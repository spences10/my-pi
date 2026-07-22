import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import type { HarnessContract } from '@spences10/pi-harness';
import { describe, expect, it } from 'vitest';
import { create_factory_guard } from './guard.js';

function guarded_tool_calls() {
	let handler:
		| ((event: {
				toolName: string;
				input: unknown;
		  }) => Promise<{ block: true; reason: string } | undefined>)
		| undefined;
	const pi = {
		on(event: string, callback: typeof handler) {
			if (event === 'tool_call') handler = callback;
		},
	} as unknown as ExtensionAPI;
	const contract = {
		version: 2,
		id: 'guard-test',
		policy: {
			cwd: '/repo',
			forbidden_paths: ['secret/**'],
			forbidden_commands: ['rm -rf'],
		},
		scaffold: {
			allowed_paths: ['src/**'],
			allow_test_changes: false,
		},
	} as HarnessContract;
	create_factory_guard(contract)(pi);
	return handler!;
}

describe('owned executor harness guard', () => {
	it('blocks writes outside harness paths and forbidden test edits', async () => {
		const call = guarded_tool_calls();
		expect(
			await call({ toolName: 'write', input: { path: 'README.md' } }),
		).toMatchObject({ block: true });
		expect(
			await call({
				toolName: 'edit',
				input: { path: 'src/a.test.ts' },
			}),
		).toMatchObject({ block: true });
		expect(
			await call({ toolName: 'write', input: { path: 'src/a.ts' } }),
		).toBeUndefined();
	});

	it('blocks forbidden commands and recursive agent delegation', async () => {
		const call = guarded_tool_calls();
		expect(
			await call({
				toolName: 'bash',
				input: { command: 'rm -rf build' },
			}),
		).toMatchObject({ block: true });
		expect(
			await call({
				toolName: 'bash',
				input: { command: 'pi -p fix' },
			}),
		).toMatchObject({ block: true });
	});
});
