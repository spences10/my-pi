import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import { describe, expect, it, vi } from 'vitest';
import confirm_destructive from './index.js';

function create_test_pi() {
	const events = new Map<string, any>();
	const pi = {
		on(name: string, handler: any) {
			events.set(name, handler);
		},
	} as unknown as ExtensionAPI;
	return { pi, events };
}

function create_context(overrides: Partial<any> = {}) {
	const notify = vi.fn();
	const confirm = vi.fn();
	const select = vi.fn();

	const ctx = {
		hasUI: true,
		ui: {
			notify,
			confirm,
			select,
		},
		sessionManager: {
			getEntries: vi.fn().mockReturnValue([]),
		},
		...overrides,
	};

	return { ctx, notify, confirm, select };
}

describe('confirm-destructive extension', () => {
	it('confirms before clearing a session and cancels on rejection', async () => {
		const { pi, events } = create_test_pi();
		await confirm_destructive(pi);

		const handler = events.get('session_before_switch');
		const { ctx, confirm, notify } = create_context();
		confirm.mockResolvedValue(false);

		const result = await handler({ reason: 'new' }, ctx);

		expect(confirm).toHaveBeenCalledWith(
			'Clear session?',
			'This will delete all messages in the current session.',
		);
		expect(notify).toHaveBeenCalledWith('Clear cancelled', 'info');
		expect(result).toEqual({ cancel: true });
	});

	it('allows clearing a session when confirmed', async () => {
		const { pi, events } = create_test_pi();
		await confirm_destructive(pi);

		const handler = events.get('session_before_switch');
		const { ctx, confirm, notify } = create_context();
		confirm.mockResolvedValue(true);

		const result = await handler({ reason: 'new' }, ctx);

		expect(confirm).toHaveBeenCalledOnce();
		expect(notify).not.toHaveBeenCalled();
		expect(result).toBeUndefined();
	});

	it('does not prompt when switching sessions without user messages', async () => {
		const { pi, events } = create_test_pi();
		await confirm_destructive(pi);

		const handler = events.get('session_before_switch');
		const { ctx, confirm } = create_context({
			sessionManager: {
				getEntries: vi.fn().mockReturnValue([
					{
						type: 'message',
						message: { role: 'assistant' },
					},
				]),
			},
		});

		const result = await handler({ reason: 'resume' }, ctx);

		expect(confirm).not.toHaveBeenCalled();
		expect(result).toBeUndefined();
	});

	it('confirms before switching sessions when user messages exist', async () => {
		const { pi, events } = create_test_pi();
		await confirm_destructive(pi);

		const handler = events.get('session_before_switch');
		const { ctx, confirm, notify } = create_context({
			sessionManager: {
				getEntries: vi.fn().mockReturnValue([
					{
						type: 'message',
						message: { role: 'user' },
					},
				]),
			},
		});
		confirm.mockResolvedValue(false);

		const result = await handler({ reason: 'resume' }, ctx);

		expect(confirm).toHaveBeenCalledWith(
			'Switch session?',
			'You have messages in the current session. Switch anyway?',
		);
		expect(notify).toHaveBeenCalledWith('Switch cancelled', 'info');
		expect(result).toEqual({ cancel: true });
	});

	it('confirms before forking and cancels when declined', async () => {
		const { pi, events } = create_test_pi();
		await confirm_destructive(pi);

		const handler = events.get('session_before_fork');
		const { ctx, select, notify } = create_context();
		select.mockResolvedValue('No, stay in current session');

		const result = await handler(
			{ entryId: '1234567890abcdef' },
			ctx,
		);

		expect(select).toHaveBeenCalledWith('Fork from entry 12345678?', [
			'Yes, create fork',
			'No, stay in current session',
		]);
		expect(notify).toHaveBeenCalledWith('Fork cancelled', 'info');
		expect(result).toEqual({ cancel: true });
	});

	it('allows forking when confirmed', async () => {
		const { pi, events } = create_test_pi();
		await confirm_destructive(pi);

		const handler = events.get('session_before_fork');
		const { ctx, select, notify } = create_context();
		select.mockResolvedValue('Yes, create fork');

		const result = await handler(
			{ entryId: '1234567890abcdef' },
			ctx,
		);

		expect(select).toHaveBeenCalledOnce();
		expect(notify).not.toHaveBeenCalled();
		expect(result).toBeUndefined();
	});
});
