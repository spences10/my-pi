import type { ExtensionContext } from '@earendil-works/pi-coding-agent';
import { spawn } from 'node:child_process';

const DEEPGRAM_URL =
	'wss://api.deepgram.com/v1/listen?model=nova-3&encoding=linear16&sample_rate=16000&channels=1&smart_format=true&interim_results=false';

export class Dictation {
	private socket: WebSocket | undefined;
	private recorder: ReturnType<typeof spawn> | undefined;
	private transcript: string[] = [];
	private pendingAudio: Uint8Array<ArrayBuffer>[] = [];
	private finishing = false;

	constructor(
		private readonly ctx: ExtensionContext,
		private readonly get_api_key: () => string | undefined,
	) {}

	get active(): boolean {
		return this.socket !== undefined;
	}

	start(): void {
		if (this.active) return;
		const apiKey = this.get_api_key();
		if (!apiKey) {
			this.ctx.ui.notify(
				'DEEPGRAM_API_KEY or DEEPGRAM is not set.',
				'error',
			);
			return;
		}

		this.transcript = [];
		this.pendingAudio = [];
		this.finishing = false;
		this.ctx.ui.setStatus('talk', 'talk: listening');

		const socket = new WebSocket(DEEPGRAM_URL, ['token', apiKey]);
		this.socket = socket;
		const recorder = spawn(
			'pw-record',
			[
				'--raw',
				'--rate',
				'16000',
				'--channels',
				'1',
				'--format',
				's16',
				'-',
			],
			{ stdio: ['ignore', 'pipe', 'pipe'] },
		);
		this.recorder = recorder;
		recorder.stderr?.resume();
		recorder.stdout?.on('data', (chunk: Buffer) => {
			if (this.socket !== socket || this.finishing) return;
			const audio = new Uint8Array(chunk.byteLength);
			audio.set(chunk);
			if (socket.readyState === WebSocket.OPEN) socket.send(audio);
			else this.pendingAudio.push(audio);
		});
		recorder.once('error', (error) => {
			if (this.socket === socket) this.fail(error.message);
		});

		socket.onopen = () => {
			if (this.socket !== socket) return;
			for (const audio of this.pendingAudio) socket.send(audio);
			this.pendingAudio = [];
			if (this.finishing) {
				socket.send(JSON.stringify({ type: 'CloseStream' }));
			}
		};
		socket.onmessage = (event) => {
			if (this.socket !== socket || typeof event.data !== 'string')
				return;
			try {
				const message = JSON.parse(event.data) as {
					type?: string;
					is_final?: boolean;
					channel?: { alternatives?: Array<{ transcript?: string }> };
				};
				if (message.type === 'Error') {
					this.fail('Deepgram rejected the audio stream.');
					return;
				}
				const text =
					message.channel?.alternatives?.[0]?.transcript?.trim();
				if (message.is_final && text) this.transcript.push(text);
			} catch {
				// Ignore non-transcript messages.
			}
		};
		socket.onerror = () => {
			if (this.socket === socket)
				this.fail('Deepgram connection failed.');
		};
		socket.onclose = () => {
			if (this.socket !== socket) return;
			const text = this.transcript.join(' ').trim();
			this.cleanup();
			if (text) {
				// Read at completion so typing, edits, and deletions made
				// during recording/transcription are never rolled back.
				const currentText = this.ctx.ui.getEditorText();
				const separator =
					currentText && !/\s$/u.test(currentText) ? ' ' : '';
				this.ctx.ui.setEditorText(
					`${currentText}${separator}${text}`,
				);
			}
			this.ctx.ui.setStatus('talk', 'talk: ready');
		};
	}

	stop(): void {
		if (!this.socket || this.finishing) return;
		this.finishing = true;
		this.ctx.ui.setStatus('talk', 'talk: transcribing');
		this.recorder?.kill('SIGINT');
		this.recorder = undefined;
		if (this.socket.readyState === WebSocket.OPEN) {
			this.socket.send(JSON.stringify({ type: 'CloseStream' }));
		}
	}

	cancel(): void {
		this.cleanup();
	}

	private fail(message: string): void {
		this.cleanup();
		this.ctx.ui.setStatus('talk', 'talk: error');
		this.ctx.ui.notify(message, 'error');
	}

	private cleanup(): void {
		const socket = this.socket;
		this.socket = undefined;
		socket?.close();
		this.recorder?.kill('SIGINT');
		this.recorder = undefined;
		this.finishing = false;
		this.pendingAudio = [];
	}
}
