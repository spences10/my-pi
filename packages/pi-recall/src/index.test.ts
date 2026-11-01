import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { describe, expect, it, vi } from 'vite-plus/test';
import recall, * as recall_entrypoint from './index.js';

type PromptEvent = {
	systemPrompt: string;
	systemPromptOptions: {
		selectedTools?: string[];
		sections: Record<string, string>;
	};
};
type PromptHandler = (event: PromptEvent) => void;

async function register_extension() {
	const handlers = new Map<string, Function>();
	const on = vi.fn((name: string, handler: Function) => {
		handlers.set(name, handler);
	});
	const register_command = vi.fn();
	await recall({
		on,
		registerCommand: register_command,
	} as unknown as ExtensionAPI);
	return { handlers, on, register_command };
}

describe('recall extension', () => {
	it('preserves the published prompt guard named export', () => {
		expect(recall_entrypoint.should_inject_recall_prompt).toBeTypeOf(
			'function',
		);
	});

	it('registers recall commands and lifecycle hooks', async () => {
		const { handlers, on, register_command } =
			await register_extension();
		expect(register_command).toHaveBeenCalledWith(
			'resume-recall',
			expect.objectContaining({
				description: expect.any(String),
				handler: expect.any(Function),
			}),
		);
		expect(register_command).toHaveBeenCalledTimes(1);
		expect(on).toHaveBeenCalledWith(
			'session_start',
			expect.any(Function),
		);
		expect(on).toHaveBeenCalledWith(
			'session_shutdown',
			expect.any(Function),
		);
		expect(on).toHaveBeenCalledWith(
			'before_agent_start',
			expect.any(Function),
		);
		await expect(
			handlers.get('session_start')?.(),
		).resolves.toBeUndefined();
		await expect(
			handlers.get('session_shutdown')?.(),
		).resolves.toBeUndefined();
	});

	it.each([undefined, ['read', 'bash']])(
		'adds a named section with shell tools %j',
		async (selectedTools) => {
			const { handlers } = await register_extension();
			const handler = handlers.get(
				'before_agent_start',
			) as PromptHandler;
			const event: PromptEvent = {
				systemPrompt: 'base',
				systemPromptOptions: {
					selectedTools,
					sections: { unrelated: 'keep' },
				},
			};
			expect(handler(event)).toBeUndefined();
			expect(event.systemPrompt).toBe('base');
			expect(
				event.systemPromptOptions.sections.session_recall,
			).toContain('Session Recall');
			expect(event.systemPromptOptions.sections.unrelated).toBe(
				'keep',
			);
		},
	);

	it('clears its section when bash becomes unavailable', async () => {
		const { handlers } = await register_extension();
		const handler = handlers.get(
			'before_agent_start',
		) as PromptHandler;
		const event: PromptEvent = {
			systemPrompt: 'base',
			systemPromptOptions: {
				selectedTools: ['read', 'write'],
				sections: { session_recall: 'stale', unrelated: 'keep' },
			},
		};
		expect(handler(event)).toBeUndefined();
		expect(event.systemPromptOptions.sections).toEqual({
			unrelated: 'keep',
		});
	});
});
