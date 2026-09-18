import { describe, expect, it } from 'vite-plus/test';
import { create_hooks_trust_subject } from './trust-gate.js';

describe('src/extensions/hooks-resolution/trust-gate.ts', () => {
	it('loads without side effects', async () => {
		await expect(import('./trust-gate.js')).resolves.toBeDefined();
	});

	it('creates a trust subject describing hook sources and commands', () => {
		const subject = create_hooks_trust_subject({
			project_dir: '/repo',
			hash: 'abc',
			sources: ['/repo/.claude/settings.json'],
			hooks: [
				{
					event_name: 'PreToolUse',
					matcher_text: 'bash',
					command: 'echo ok',
					source: '/repo/.claude/settings.json',
				},
			],
		});

		expect(subject).toMatchObject({
			kind: 'hooks-config',
			id: '/repo',
			store_key: '/repo',
			hash: 'abc',
		});
		expect(subject.summary_lines?.join('\n')).toContain(
			'PreToolUse matcher=bash: echo ok',
		);
	});
});
