import type {
	ExtensionContext,
	TerminalInputHandler,
} from '@earendil-works/pi-coding-agent';
import {
	Editor,
	type EditorTheme,
	type TUI,
} from '@earendil-works/pi-tui';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { vi } from 'vite-plus/test';
import { Dictation } from '../src/dictation.js';

export function create_editor() {
	return new Editor({ requestRender: vi.fn() } as unknown as TUI, {
		borderColor: (text) => text,
		selectList: {} as EditorTheme['selectList'],
	});
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
	const recorder = Object.assign(new EventEmitter(), {
		stdout: new EventEmitter(),
		stderr: { resume: vi.fn() },
		kill: vi.fn(),
	});
	vi.mocked(spawn).mockReturnValue(
		recorder as unknown as ReturnType<typeof spawn>,
	);
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
	const ctx = { mode: 'tui', ui } as unknown as ExtensionContext;
	return {
		dictation: new Dictation(ctx, () => 'test-key'),
		editor,
		ui,
		ctx,
		recorder,
	};
}
