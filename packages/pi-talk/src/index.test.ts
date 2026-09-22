import {
	getAgentDir,
	type ExtensionAPI,
} from '@earendil-works/pi-coding-agent';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { FakeSocket, setup_dictation } from '../test/helpers.js';
import talk, { write_talk_secrets } from './index.js';

vi.mock('@earendil-works/pi-coding-agent', () => ({
	getAgentDir: vi.fn(),
}));
vi.mock('node:child_process', () => ({ spawn: vi.fn() }));

const temporary_dirs: string[] = [];
afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
	vi.unstubAllEnvs();
	vi.clearAllMocks();
	for (const dir of temporary_dirs.splice(0))
		rmSync(dir, { recursive: true, force: true });
});

function setup_extension(enabled = true) {
	const state = setup_dictation();
	const dir = mkdtempSync(join(tmpdir(), 'pi-talk-integration-'));
	temporary_dirs.push(dir);
	vi.mocked(getAgentDir).mockReturnValue(dir);
	vi.stubEnv('DEEPGRAM_API_KEY', 'test-key');
	vi.stubEnv('DEEPGRAM', '');
	write_talk_secrets({ enabled });
	const on = vi.fn();
	const registerCommand = vi.fn();
	const registerShortcut = vi.fn();
	talk({
		on,
		registerCommand,
		registerShortcut,
	} as unknown as ExtensionAPI);
	on.mock.calls.find(([event]) => event === 'session_start')?.[1](
		{},
		state.ctx,
	);
	const input = state.ui.onTerminalInput.mock.calls[0]?.[0];
	return {
		...state,
		command: (action: string) =>
			registerCommand.mock.calls[0][1].handler(action, state.ctx),
		registerShortcut,
		input,
		start_hold: () => {
			for (const delay of [0, 500, 30]) {
				vi.advanceTimersByTime(delay);
				if (!input?.(' ')?.consume) state.editor.handleInput(' ');
			}
		},
		shutdown: () =>
			on.mock.calls.find(
				([event]) => event === 'session_shutdown',
			)?.[1](),
	};
}

describe('Talk integration', () => {
	it('keeps fast typing intact through the registered terminal listener', () => {
		vi.useFakeTimers();
		const { input, editor, ui, shutdown } = setup_extension();
		for (const key of 'hello world next ') {
			if (!input?.(key)?.consume) editor.handleInput(key);
			vi.advanceTimersByTime(30);
		}
		expect(editor.getText()).toBe('hello world next ');
		expect(ui.setEditorText).not.toHaveBeenCalled();
		expect(spawn).not.toHaveBeenCalled();
		shutdown();
	});

	it('records with raw Space, preserving edits while transcribing', () => {
		vi.useFakeTimers();
		const { start_hold, editor, registerShortcut, shutdown } =
			setup_extension();
		editor.setText('hello');
		start_hold();
		const socket = FakeSocket.instances[0];
		socket.open();
		vi.advanceTimersByTime(180);
		expect(socket.send).toHaveBeenCalledWith(
			JSON.stringify({ type: 'CloseStream' }),
		);
		editor.setText('hello typed');
		socket.finish('spoken words');
		expect(editor.getText()).toBe('hello typed spoken words');
		expect(registerShortcut).not.toHaveBeenCalled();
		shutdown();
	});

	it('does not intercept input while disabled', () => {
		const { ui, shutdown } = setup_extension(false);
		expect(spawn).not.toHaveBeenCalled();
		expect(ui.onTerminalInput).not.toHaveBeenCalled();
		shutdown();
	});

	it('disabling Talk cancels recording and ignores a late transcript', async () => {
		vi.useFakeTimers();
		const { start_hold, command, editor, recorder, ui, shutdown } =
			setup_extension();
		start_hold();
		const socket = FakeSocket.instances[0];
		await command('off');
		editor.setText('keep this');
		socket.finish('late words');
		expect(editor.getText()).toBe('keep this');
		expect(recorder.kill).toHaveBeenCalledWith('SIGINT');
		expect(
			ui.onTerminalInput.mock.results[0].value,
		).toHaveBeenCalledOnce();
		shutdown();
	});
});
