import { isKeyRelease } from '@earendil-works/pi-tui';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { create_editor } from '../test/helpers.js';
import { HoldSpace } from './hold-space.js';

function setup() {
	const callbacks = {
		on_start: vi.fn(() => true),
		on_stop: vi.fn(),
	};
	const hold = new HoldSpace(callbacks);
	const editor = create_editor();
	return {
		hold,
		callbacks,
		editor,
		input: (data: string) => {
			if (!hold.handle(data) && !isKeyRelease(data))
				editor.handleInput(data);
		},
	};
}

afterEach(() => vi.useRealTimers());

describe('HoldSpace', () => {
	it.each([20, 100, 200, 649, 651])(
		'preserves fast typing with raw keys %i ms apart',
		(delay) => {
			vi.useFakeTimers();
			const { input, editor, callbacks } = setup();
			for (const key of 'hello world  next ') {
				input(key);
				vi.advanceTimersByTime(delay);
			}
			expect(editor.getText()).toBe('hello world  next ');
			expect(callbacks.on_start).not.toHaveBeenCalled();
		},
	);

	it.each([30, 300, 600])(
		'preserves raw double taps %i ms apart',
		(delay) => {
			vi.useFakeTimers();
			const { input, editor, callbacks } = setup();
			input(' ');
			vi.advanceTimersByTime(delay);
			input(' ');
			vi.advanceTimersByTime(1_000);
			expect(editor.getText()).toBe('  ');
			expect(callbacks.on_start).not.toHaveBeenCalled();
		},
	);

	it('records a sustained raw hold and stops when repeats cease', () => {
		vi.useFakeTimers();
		const { input, editor, callbacks } = setup();
		input('hello');
		input(' ');
		vi.advanceTimersByTime(500);
		input(' ');
		expect(callbacks.on_start).not.toHaveBeenCalled();
		vi.advanceTimersByTime(30);
		input(' ');
		expect(callbacks.on_start).toHaveBeenCalledOnce();
		vi.advanceTimersByTime(30);
		input(' ');
		expect(editor.getText()).toBe('hello  ');
		vi.advanceTimersByTime(180);
		expect(callbacks.on_stop).toHaveBeenCalledOnce();
	});

	it('cancels raw candidates on typing, navigation and paste', () => {
		vi.useFakeTimers();
		const { input, callbacks } = setup();
		for (const other of [
			'x',
			'\u001b[D',
			'\u001b[200~paste\u001b[201~',
		]) {
			input(' ');
			vi.advanceTimersByTime(500);
			input(other);
			input(' ');
			vi.advanceTimersByTime(30);
			input(' ');
			vi.advanceTimersByTime(200);
		}
		expect(callbacks.on_start).not.toHaveBeenCalled();
	});

	it('inserts an encoded tap before an overlapping next letter', () => {
		vi.useFakeTimers();
		const { input, editor, callbacks } = setup();
		input('hello');
		input('\u001b[32u');
		expect(editor.getText()).toBe('hello ');
		input('w');
		vi.advanceTimersByTime(100);
		input('\u001b[32;1:3u');
		expect(editor.getText()).toBe('hello w');
		expect(callbacks.on_start).not.toHaveBeenCalled();
	});

	it('requires an explicit repeat and stops on release', () => {
		vi.useFakeTimers();
		const { input, editor, callbacks } = setup();
		input('hello');
		input('\u001b[32u');
		vi.advanceTimersByTime(100);
		input('\u001b[32;1:2u');
		expect(callbacks.on_start).not.toHaveBeenCalled();
		vi.advanceTimersByTime(300);
		expect(callbacks.on_start).not.toHaveBeenCalled();
		input('\u001b[32;1:2u');
		input('\u001b[32;1:2u');
		expect(callbacks.on_start).toHaveBeenCalledOnce();
		input('\u001b[32;1:3u');
		expect(callbacks.on_stop).toHaveBeenCalledOnce();
		expect(editor.getText()).toBe('hello ');
	});

	it('does not infer a hold from encoded presses without event types', () => {
		vi.useFakeTimers();
		const { input, editor, callbacks } = setup();
		input('\u001b[32u');
		vi.advanceTimersByTime(1_000);
		input('\u001b[32u');
		vi.advanceTimersByTime(1_000);
		expect(editor.getText()).toBe('  ');
		expect(callbacks.on_start).not.toHaveBeenCalled();
	});

	it.each(['x', '\u001b[D', '\u001b[200~pasted text\u001b[201~'])(
		'cancels a pending hold on other input: %j',
		(data) => {
			vi.useFakeTimers();
			const { input, callbacks } = setup();
			input('\u001b[32u');
			input(data);
			vi.advanceTimersByTime(500);
			input('\u001b[32;1:2u');
			expect(callbacks.on_start).not.toHaveBeenCalled();
		},
	);

	it('allows unrelated key releases and stops a recording hold on typing', () => {
		vi.useFakeTimers();
		const { input, callbacks } = setup();
		input('\u001b[32u');
		input('\u001b[120;1:3u');
		vi.advanceTimersByTime(500);
		input('\u001b[32;1:2u');
		expect(callbacks.on_start).toHaveBeenCalledOnce();
		input('x');
		input('\u001b[32;1:3u');
		expect(callbacks.on_stop).toHaveBeenCalledOnce();
	});

	it('does not stop a previous recording still transcribing', () => {
		vi.useFakeTimers();
		const { input, callbacks } = setup();
		callbacks.on_start.mockReturnValue(false);
		input('\u001b[32u');
		vi.advanceTimersByTime(500);
		input('\u001b[32;1:2u');
		input('\u001b[32;1:3u');
		expect(callbacks.on_stop).not.toHaveBeenCalled();
	});
});
