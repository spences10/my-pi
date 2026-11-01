import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import turn_timer, {
	format_clock,
	format_duration,
} from './index.js';

function fixture(mode = 'tui') {
	const events = new Map<string, Function>();
	const appendEntry = vi.fn();
	const registerEntryRenderer = vi.fn();
	turn_timer({
		on: (name: string, handler: Function) =>
			events.set(name, handler),
		appendEntry,
		registerEntryRenderer,
	} as unknown as ExtensionAPI);
	const ctx = {
		mode,
		ui: {
			setWorkingMessage: vi.fn(),
			theme: { fg: (_color: string, text: string) => text },
		},
	};
	return {
		events,
		ctx,
		appendEntry,
		registerEntryRenderer,
		emit: (name: string, event = {}) =>
			events.get(name)?.(event, ctx),
	};
}

afterEach(() => {
	vi.clearAllTimers();
	vi.useRealTimers();
});

describe('turn timer', () => {
	it('formats short and long durations', () => {
		expect(format_clock(-1)).toBe('00:00');
		expect(format_clock(3661000)).toBe('01:01:01');
		expect(format_duration(123)).toBe('123ms');
		expect(format_duration(1234)).toBe('1.2s');
		expect(format_duration(61000)).toBe('01:01');
	});

	it('times a complete interaction across retries and queued continuations', () => {
		vi.useFakeTimers();
		const f = fixture();
		f.emit('agent_start');
		vi.advanceTimersByTime(2000);
		expect(f.ctx.ui.setWorkingMessage).toHaveBeenLastCalledWith(
			'Working... 00:02',
		);
		f.emit('agent_end');
		f.emit('agent_start');
		vi.advanceTimersByTime(3000);
		expect(f.appendEntry).not.toHaveBeenCalled();
		f.emit('agent_settled', { aborted: false });
		expect(f.appendEntry).toHaveBeenCalledWith('turn-timer', {
			duration_ms: 5000,
			completed_at: expect.any(String),
			aborted: false,
		});
		expect(f.ctx.ui.setWorkingMessage).toHaveBeenLastCalledWith();
		expect(vi.getTimerCount()).toBe(0);
		f.emit('agent_settled');
		expect(f.appendEntry).toHaveBeenCalledTimes(1);
	});

	it('records stopped interactions and starts the next duration afresh', () => {
		vi.useFakeTimers();
		const f = fixture();
		f.emit('agent_start');
		vi.advanceTimersByTime(500);
		f.emit('agent_settled', { aborted: true });
		expect(f.appendEntry).toHaveBeenLastCalledWith(
			'turn-timer',
			expect.objectContaining({ duration_ms: 500, aborted: true }),
		);
		f.emit('agent_start');
		vi.advanceTimersByTime(250);
		f.emit('agent_settled', { aborted: false });
		expect(f.appendEntry).toHaveBeenLastCalledWith(
			'turn-timer',
			expect.objectContaining({ duration_ms: 250 }),
		);
	});

	it.each(['session_shutdown', 'session_start'])(
		'cleans up on %s without leaking into another runtime',
		(event) => {
			vi.useFakeTimers();
			const f = fixture();
			f.emit('agent_start');
			vi.advanceTimersByTime(1000);
			f.emit(event);
			const calls = f.ctx.ui.setWorkingMessage.mock.calls.length;
			vi.advanceTimersByTime(5000);
			expect(f.ctx.ui.setWorkingMessage).toHaveBeenCalledTimes(calls);
			expect(vi.getTimerCount()).toBe(0);
			f.emit('agent_settled');
			expect(f.appendEntry).not.toHaveBeenCalled();
			f.emit('agent_start');
			vi.advanceTimersByTime(2000);
			f.emit('agent_settled', { aborted: false });
			expect(f.appendEntry).toHaveBeenLastCalledWith(
				'turn-timer',
				expect.objectContaining({ duration_ms: 2000 }),
			);
		},
	);

	it('records durations without TUI calls in headless mode', () => {
		vi.useFakeTimers();
		const f = fixture('json');
		f.emit('agent_start');
		vi.advanceTimersByTime(1000);
		f.emit('agent_settled', { aborted: false });
		expect(f.ctx.ui.setWorkingMessage).not.toHaveBeenCalled();
		expect(f.appendEntry).toHaveBeenCalledTimes(1);
		expect(vi.getTimerCount()).toBe(0);
	});

	it('renders persisted entries, including older durations, and ignores invalid data', () => {
		const f = fixture();
		const render = f.registerEntryRenderer.mock.calls[0]![1];
		const theme = { fg: (_color: string, text: string) => text };
		expect(
			render({ data: { duration_ms: 1200 } }, {}, theme)
				.render(80)
				.join(''),
		).toContain('Completed in 1.2s');
		expect(
			render(
				{ data: { duration_ms: 1200, aborted: true } },
				{},
				theme,
			)
				.render(80)
				.join(''),
		).toContain('Stopped in 1.2s');
		for (const data of [
			undefined,
			{},
			{ duration_ms: NaN },
			{ duration_ms: -1 },
		])
			expect(render({ data }, {}, theme)).toBeUndefined();
	});
});
