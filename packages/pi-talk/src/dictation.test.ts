import { afterEach, describe, expect, it, vi } from 'vite-plus/test';
import { FakeSocket, setup_dictation } from '../test/helpers.js';

vi.mock('node:child_process', () => ({ spawn: vi.fn() }));

afterEach(() => {
	vi.unstubAllGlobals();
	vi.clearAllMocks();
});

describe('Dictation', () => {
	it.each(['hello typed while waiting', 'revised', '', 'hello '])(
		'preserves the latest editor contents: %j',
		(currentText) => {
			const { dictation, editor } = setup_dictation();
			editor.setText('original');
			dictation.start();
			const socket = FakeSocket.instances[0];
			socket.open();
			dictation.stop();
			editor.setText(currentText);
			socket.finish('spoken words');
			expect(editor.getText()).toBe(
				currentText === ''
					? 'spoken words'
					: `${currentText.trimEnd()} spoken words`,
			);
		},
	);

	it('leaves text untouched when there is no transcript', () => {
		const { dictation, editor, ui } = setup_dictation();
		dictation.start();
		editor.setText('keep this');
		FakeSocket.instances[0].finish('');
		expect(editor.getText()).toBe('keep this');
		expect(ui.setEditorText).not.toHaveBeenCalled();
	});

	it('flushes buffered audio when stopped before the connection opens', () => {
		const { dictation, recorder, editor } = setup_dictation();
		dictation.start();
		const socket = FakeSocket.instances[0];
		recorder.stdout.emit('data', Buffer.from([1, 2]));
		dictation.stop();
		dictation.stop();
		expect(recorder.kill).toHaveBeenCalledOnce();
		expect(socket.close).not.toHaveBeenCalled();
		socket.open();
		expect(socket.send.mock.calls).toEqual([
			[new Uint8Array([1, 2])],
			[JSON.stringify({ type: 'CloseStream' })],
		]);
		socket.finish('short recording');
		expect(editor.getText()).toBe('short recording');
	});

	it('ignores late callbacks from a cancelled recording', () => {
		const { dictation, editor, ui } = setup_dictation();
		dictation.start();
		const oldSocket = FakeSocket.instances[0];
		dictation.cancel();
		dictation.start();
		oldSocket.open();
		oldSocket.onerror?.();
		oldSocket.finish('stale words');
		expect(dictation.active).toBe(true);
		expect(ui.notify).not.toHaveBeenCalled();
		expect(oldSocket.send).not.toHaveBeenCalled();
		FakeSocket.instances[1].finish('current words');
		expect(editor.getText()).toBe('current words');
	});
});
