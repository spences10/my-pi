import type {
	ExtensionAPI,
	ExtensionContext,
} from '@earendil-works/pi-coding-agent';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import turn_timer, {
	format_clock,
	format_duration,
	TURN_TIMER_ENTRY,
} from './index.js';

describe('turn timer formatting', () => {
	it.each([
		[0, '00:00'],
		[1_000, '00:01'],
		[61_000, '01:01'],
		[3_661_000, '01:01:01'],
	])('formats %dms as %s', (duration_ms, expected) => {
		expect(format_clock(duration_ms)).toBe(expected);
	});

	it.each([
		[250, '250ms'],
		[1_250, '1.3s'],
		[61_000, '01:01'],
	])(
		'formats completed duration %dms as %s',
		(duration_ms, expected) => {
			expect(format_duration(duration_ms)).toBe(expected);
		},
	);
});

describe('turn timer extension', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.setSystemTime(new Date('2026-07-22T12:00:00.000Z'));
	});

	it('shows a live timer and appends the settled duration', async () => {
		const handlers = new Map<
			string,
			(...args: unknown[]) => unknown
		>();
		const append_entry = vi.fn();
		const register_entry_renderer = vi.fn();
		const pi = {
			on: vi.fn(
				(event: string, handler: (...args: unknown[]) => unknown) => {
					handlers.set(event, handler);
				},
			),
			appendEntry: append_entry,
			registerEntryRenderer: register_entry_renderer,
		} as unknown as ExtensionAPI;
		const set_working_message = vi.fn();
		const ctx = {
			mode: 'tui',
			ui: {
				setWorkingMessage: set_working_message,
				theme: { fg: (_color: string, text: string) => text },
			},
		} as unknown as ExtensionContext;

		turn_timer(pi);
		await handlers.get('agent_start')?.({}, ctx);
		expect(set_working_message).toHaveBeenCalledWith(
			'Working... 00:00',
		);

		vi.advanceTimersByTime(2_500);
		await handlers.get('agent_settled')?.({}, ctx);

		expect(set_working_message).toHaveBeenLastCalledWith(undefined);
		expect(append_entry).toHaveBeenCalledWith(TURN_TIMER_ENTRY, {
			duration_ms: 2_500,
			completed_at: '2026-07-22T12:00:02.500Z',
		});
		expect(register_entry_renderer).toHaveBeenCalledWith(
			TURN_TIMER_ENTRY,
			expect.any(Function),
		);
	});
});
