import { make_context } from '../../../tools/test-sdk.js';
import type { TerminalInputHandler } from '@earendil-works/pi-coding-agent';
import { Editor, type EditorTheme } from '@earendil-works/pi-tui';
import { ChildProcess, spawn } from 'node:child_process';
import { PassThrough } from 'node:stream';
import { vi } from 'vite-plus/test';
import { Dictation } from '../src/dictation.js';
import { make_tui } from '../../../tools/test-terminal.js';

export function create_editor() {
	const identity = (text: string) => text;

	const theme: EditorTheme = {
		borderColor: identity,
		selectList: {
			selectedPrefix: identity,
			selectedText: identity,
			description: identity,
			scrollInfo: identity,
			noMatch: identity,
		},
	};

	return new Editor(make_tui().tui, theme);
}

export class FakeSocket {
	static OPEN = 1;
	static instances: FakeSocket[] = [];
	readyState = 0;
	onopen?: () => void;
	onmessage?: (event: { data: string }) => void;
	onclose?: () => void;
	onerror?: () => void;
	send = vi.fn();
	close = vi.fn(() => {
		this.readyState = 3;
	});

	constructor() {
		FakeSocket.instances.push(this);
	}

	open() {
		this.readyState = FakeSocket.OPEN;
		this.onopen?.();
	}

	finish(text: string) {
		this.onmessage?.({
			data: JSON.stringify({
				is_final: true,
				channel: { alternatives: [{ transcript: text }] },
			}),
		});
		this.readyState = 3;
		this.onclose?.();
	}
}

export function setup_dictation() {
	FakeSocket.instances = [];
	vi.stubGlobal('WebSocket', FakeSocket);

	const recorder = Object.assign(new ChildProcess(), {
		stdout: new PassThrough(),
		stderr: new PassThrough(),
		kill: vi.fn<ChildProcess['kill']>(() => true),
	});

	vi.mocked(spawn).mockReturnValue(recorder);
	const editor = create_editor();

	const ui = {
		getEditorText: () => editor.getText(),
		setEditorText: vi.fn((text: string) => editor.setText(text)),
		setStatus: vi.fn(),
		notify: vi.fn(),
		onTerminalInput: vi.fn((_handler: TerminalInputHandler) =>
			vi.fn(),
		),
	};

	const ctx = make_context({ mode: 'tui', ui });

	return {
		dictation: new Dictation(ctx, () => 'test-key'),
		editor,
		ui,
		ctx,
		recorder,
	};
}
