import type {
	ExtensionAPI,
	ExtensionContext,
} from '@earendil-works/pi-coding-agent';
import {
	isKeyRelease,
	Key,
	matchesKey,
} from '@earendil-works/pi-tui';
import { spawn } from 'node:child_process';

const HOLD_MS = 300;
const DEEPGRAM_URL =
	'wss://api.deepgram.com/v1/listen?model=nova-3&encoding=linear16&sample_rate=16000&channels=1&smart_format=true&interim_results=false';

type HoldCallbacks = {
	onTap(): void;
	onLegacyPress(): void;
	onStart(restoreLegacySpace: boolean): void;
	onStop(): void;
};

export class HoldSpace {
	private timer: ReturnType<typeof setTimeout> | undefined;
	private legacyReleaseTimer:
		| ReturnType<typeof setTimeout>
		| undefined;
	private down = false;
	private recording = false;
	private legacyPresses = 0;

	constructor(private readonly callbacks: HoldCallbacks) {}

	handle(data: string): boolean {
		if (!matchesKey(data, Key.space)) return false;

		if (data === ' ') return this.handleLegacySpace();

		if (isKeyRelease(data)) {
			if (!this.down) return true;
			this.down = false;
			if (this.timer) clearTimeout(this.timer);
			this.timer = undefined;
			if (this.recording) {
				this.recording = false;
				this.callbacks.onStop();
			} else {
				this.callbacks.onTap();
			}
			return true;
		}

		if (this.down) return true;
		this.down = true;
		this.timer = setTimeout(() => {
			this.timer = undefined;
			this.recording = true;
			this.callbacks.onStart(false);
		}, HOLD_MS);
		return true;
	}

	reset(): void {
		if (this.timer) clearTimeout(this.timer);
		if (this.legacyReleaseTimer)
			clearTimeout(this.legacyReleaseTimer);
		this.timer = undefined;
		this.legacyReleaseTimer = undefined;
		this.down = false;
		this.recording = false;
		this.legacyPresses = 0;
	}

	private handleLegacySpace(): boolean {
		this.legacyPresses += 1;
		if (this.legacyPresses === 1) {
			this.callbacks.onLegacyPress();
			this.legacyReleaseTimer = setTimeout(() => this.reset(), 650);
			return false;
		}

		if (!this.recording) {
			this.recording = true;
			this.callbacks.onStart(true);
		}
		if (this.legacyReleaseTimer)
			clearTimeout(this.legacyReleaseTimer);
		this.legacyReleaseTimer = setTimeout(() => {
			this.callbacks.onStop();
			this.reset();
		}, 180);
		return true;
	}
}

class Dictation {
	private socket: WebSocket | undefined;
	private recorder: ReturnType<typeof spawn> | undefined;
	private transcript: string[] = [];
	private pendingAudio: Uint8Array<ArrayBuffer>[] = [];
	private baseText = '';
	private finishing = false;

	constructor(private readonly ctx: ExtensionContext) {}

	get active(): boolean {
		return this.socket !== undefined;
	}

	start(): void {
		if (this.active) return;
		const apiKey =
			process.env.DEEPGRAM_API_KEY ?? process.env.DEEPGRAM;
		if (!apiKey) {
			this.ctx.ui.notify(
				'DEEPGRAM_API_KEY or DEEPGRAM is not set.',
				'error',
			);
			return;
		}

		this.baseText = this.ctx.ui.getEditorText();
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
			const audio = new Uint8Array(chunk.byteLength);
			audio.set(chunk);
			if (socket.readyState === WebSocket.OPEN) socket.send(audio);
			else this.pendingAudio.push(audio);
		});
		recorder.once('error', (error) => this.fail(error.message));

		socket.onopen = () => {
			for (const audio of this.pendingAudio) socket.send(audio);
			this.pendingAudio = [];
			if (this.finishing) {
				socket.send(JSON.stringify({ type: 'CloseStream' }));
			}
		};
		socket.onmessage = (event) => {
			if (typeof event.data !== 'string') return;
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
		socket.onerror = () => this.fail('Deepgram connection failed.');
		socket.onclose = () => {
			if (this.socket !== socket) return;
			const text = this.transcript.join(' ').trim();
			this.cleanup();
			if (text) {
				const separator =
					this.baseText && !/\s$/u.test(this.baseText) ? ' ' : '';
				this.ctx.ui.setEditorText(
					`${this.baseText}${separator}${text}`,
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
		} else {
			this.socket.close();
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

export default function talk(pi: ExtensionAPI): void {
	let unsubscribe: (() => void) | undefined;
	let hold: HoldSpace | undefined;
	let dictation: Dictation | undefined;
	let context: ExtensionContext | undefined;
	let legacyBaseText = '';

	pi.on('session_start', (_event, ctx) => {
		if (ctx.mode !== 'tui') return;
		unsubscribe?.();
		dictation?.cancel();
		context = ctx;
		dictation = new Dictation(ctx);
		hold = new HoldSpace({
			onTap: () => ctx.ui.pasteToEditor(' '),
			onLegacyPress: () => {
				legacyBaseText = ctx.ui.getEditorText();
			},
			onStart: (restoreLegacySpace) => {
				if (restoreLegacySpace) ctx.ui.setEditorText(legacyBaseText);
				dictation?.start();
			},
			onStop: () => dictation?.stop(),
		});
		ctx.ui.setStatus('talk', 'talk: ready');
		unsubscribe = ctx.ui.onTerminalInput((data) =>
			hold?.handle(data) ? { consume: true } : undefined,
		);
	});

	pi.on('session_shutdown', () => {
		unsubscribe?.();
		unsubscribe = undefined;
		hold?.reset();
		dictation?.cancel();
		context?.ui.setStatus('talk', undefined);
		hold = undefined;
		dictation = undefined;
		context = undefined;
	});
}
