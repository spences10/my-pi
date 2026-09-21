import {
	getAgentDir,
	type ExtensionAPI,
	type ExtensionContext,
} from '@earendil-works/pi-coding-agent';
import {
	Input,
	isKeyRelease,
	Key,
	matchesKey,
} from '@earendil-works/pi-tui';
import { spawn } from 'node:child_process';
import {
	chmodSync,
	mkdirSync,
	readFileSync,
	renameSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { dirname, join } from 'node:path';

const HOLD_MS = 300;
const DEEPGRAM_URL =
	'wss://api.deepgram.com/v1/listen?model=nova-3&encoding=linear16&sample_rate=16000&channels=1&smart_format=true&interim_results=false';
const SECRETS_FILE = 'my-pi-secrets.json';

type SecretsFile = {
	version: 1;
	packages: Record<
		string,
		{ deepgramApiKey?: string; enabled?: boolean } | undefined
	>;
};

function empty_secrets(): SecretsFile {
	return { version: 1, packages: {} };
}

export function read_talk_secrets(
	path = join(getAgentDir(), SECRETS_FILE),
) {
	try {
		const parsed = JSON.parse(
			readFileSync(path, 'utf8'),
		) as SecretsFile;
		const talk = parsed.packages?.['pi-talk'];
		return {
			enabled: talk?.enabled === true,
			apiKey:
				typeof talk?.deepgramApiKey === 'string'
					? talk.deepgramApiKey
					: undefined,
		};
	} catch {
		return { enabled: false, apiKey: undefined };
	}
}

export function write_talk_secrets(
	value: { enabled: boolean; apiKey?: string },
	path = join(getAgentDir(), SECRETS_FILE),
): void {
	let secrets = empty_secrets();
	try {
		secrets = JSON.parse(readFileSync(path, 'utf8')) as SecretsFile;
	} catch (error) {
		if (
			!(error instanceof Error) ||
			!('code' in error) ||
			error.code !== 'ENOENT'
		) {
			throw error;
		}
	}
	secrets.version = 1;
	secrets.packages ??= {};
	secrets.packages['pi-talk'] = {
		enabled: value.enabled,
		...(value.apiKey ? { deepgramApiKey: value.apiKey } : {}),
	};
	mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
	const temporary = `${path}.${process.pid}.tmp`;
	writeFileSync(temporary, `${JSON.stringify(secrets, null, 2)}\n`, {
		mode: 0o600,
	});
	chmodSync(temporary, 0o600);
	renameSync(temporary, path);
	chmodSync(path, 0o600);
}

export function forget_talk_secrets(
	path = join(getAgentDir(), SECRETS_FILE),
): void {
	let secrets: SecretsFile;
	try {
		secrets = JSON.parse(readFileSync(path, 'utf8')) as SecretsFile;
	} catch {
		return;
	}
	delete secrets.packages?.['pi-talk'];
	if (Object.keys(secrets.packages ?? {}).length === 0) {
		rmSync(path, { force: true });
		return;
	}
	const temporary = `${path}.${process.pid}.tmp`;
	writeFileSync(temporary, `${JSON.stringify(secrets, null, 2)}\n`, {
		mode: 0o600,
	});
	renameSync(temporary, path);
	chmodSync(path, 0o600);
}

type HoldCallbacks = {
	on_tap(): void;
	on_legacy_press(): void;
	on_start(restoreLegacySpace: boolean): void;
	on_stop(): void;
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

		if (data === ' ') return this.handle_legacy_space();

		if (isKeyRelease(data)) {
			if (!this.down) return true;
			this.down = false;
			if (this.timer) clearTimeout(this.timer);
			this.timer = undefined;
			if (this.recording) {
				this.recording = false;
				this.callbacks.on_stop();
			} else {
				this.callbacks.on_tap();
			}
			return true;
		}

		if (this.down) return true;
		this.down = true;
		this.timer = setTimeout(() => {
			this.timer = undefined;
			this.recording = true;
			this.callbacks.on_start(false);
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

	private handle_legacy_space(): boolean {
		this.legacyPresses += 1;
		if (this.legacyPresses === 1) {
			this.callbacks.on_legacy_press();
			this.legacyReleaseTimer = setTimeout(() => this.reset(), 650);
			return false;
		}

		if (!this.recording) {
			this.recording = true;
			this.callbacks.on_start(true);
		}
		if (this.legacyReleaseTimer)
			clearTimeout(this.legacyReleaseTimer);
		this.legacyReleaseTimer = setTimeout(() => {
			this.callbacks.on_stop();
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

async function prompt_for_secret(
	ctx: ExtensionContext,
): Promise<string | undefined> {
	return ctx.ui.custom<string | undefined>(
		(tui, theme, _kb, done) => {
			const input = new Input();
			return {
				focused: true,
				handleInput(data: string) {
					if (matchesKey(data, Key.enter)) {
						done(input.getValue().trim() || undefined);
						return;
					}
					if (matchesKey(data, Key.escape)) {
						done(undefined);
						return;
					}
					input.handleInput(data);
					tui.requestRender();
				},
				render(_width: number) {
					const label = theme.fg('accent', 'Deepgram API key: ');
					const masked = '•'.repeat(input.getValue().length);
					return [`${label}${masked}`];
				},
				invalidate() {},
			};
		},
	);
}

export default function talk(pi: ExtensionAPI): void {
	let unsubscribe: (() => void) | undefined;
	let hold: HoldSpace | undefined;
	let dictation: Dictation | undefined;
	let context: ExtensionContext | undefined;
	let legacyBaseText = '';
	let enabled = false;

	function key_source(): 'environment' | 'stored' | undefined {
		if (process.env.DEEPGRAM_API_KEY ?? process.env.DEEPGRAM) {
			return 'environment';
		}
		if (read_talk_secrets().apiKey) return 'stored';
		return undefined;
	}

	function current_api_key(): string | undefined {
		return (
			process.env.DEEPGRAM_API_KEY ??
			process.env.DEEPGRAM ??
			read_talk_secrets().apiKey
		);
	}

	function deactivate(): void {
		unsubscribe?.();
		unsubscribe = undefined;
		hold?.reset();
		dictation?.cancel();
		context?.ui.setStatus('talk', undefined);
		hold = undefined;
		dictation = undefined;
	}

	function activate(ctx: ExtensionContext): void {
		deactivate();
		context = ctx;
		dictation = new Dictation(ctx, current_api_key);
		hold = new HoldSpace({
			on_tap: () => ctx.ui.pasteToEditor(' '),
			on_legacy_press: () => {
				legacyBaseText = ctx.ui.getEditorText();
			},
			on_start: (restoreLegacySpace) => {
				if (restoreLegacySpace) ctx.ui.setEditorText(legacyBaseText);
				dictation?.start();
			},
			on_stop: () => dictation?.stop(),
		});
		ctx.ui.setStatus('talk', 'talk: ready');
		unsubscribe = ctx.ui.onTerminalInput((data) =>
			hold?.handle(data) ? { consume: true } : undefined,
		);
	}

	pi.on('session_start', (_event, ctx) => {
		if (ctx.mode !== 'tui') return;
		context = ctx;
		enabled = read_talk_secrets().enabled;
		if (enabled && current_api_key()) activate(ctx);
	});

	pi.registerCommand('talk', {
		description: 'Set up, enable, disable, or forget Talk',
		handler: async (args, ctx) => {
			if (ctx.mode !== 'tui') return;
			const action = args.trim().toLowerCase() || 'status';
			if (action === 'setup') {
				const proceed = await ctx.ui.confirm(
					'Set up Talk',
					'Paste your Deepgram API key in the next prompt. It will be masked and stored locally with private permissions. Esc cancels.',
				);
				if (!proceed) return;
				const apiKey = await prompt_for_secret(ctx);
				if (!apiKey) {
					ctx.ui.notify('Talk setup cancelled.', 'info');
					return;
				}
				enabled = true;
				write_talk_secrets({ enabled, apiKey });
				activate(ctx);
				ctx.ui.notify(
					'Talk is ready. Hold Space to dictate.',
					'info',
				);
				return;
			}
			if (action === 'on') {
				if (!current_api_key()) {
					ctx.ui.notify(
						'Talk needs a Deepgram API key. Run /talk setup.',
						'warning',
					);
					return;
				}
				enabled = true;
				write_talk_secrets({
					enabled,
					apiKey: read_talk_secrets().apiKey,
				});
				activate(ctx);
				ctx.ui.notify('Talk is on.', 'info');
				return;
			}
			if (action === 'off') {
				enabled = false;
				write_talk_secrets({
					enabled,
					apiKey: read_talk_secrets().apiKey,
				});
				deactivate();
				context = ctx;
				ctx.ui.notify(
					'Talk is off. Your saved key was kept.',
					'info',
				);
				return;
			}
			if (action === 'forget') {
				if (!read_talk_secrets().apiKey) {
					ctx.ui.notify('Talk has no saved key to remove.', 'info');
					return;
				}
				const confirmed = await ctx.ui.confirm(
					'Forget Talk key?',
					'This removes the saved Deepgram API key and turns Talk off.',
				);
				if (!confirmed) return;
				enabled = false;
				forget_talk_secrets();
				deactivate();
				context = ctx;
				ctx.ui.notify(
					'Talk is off and its saved key was removed.',
					'info',
				);
				return;
			}
			if (action === 'status') {
				const source = key_source();
				const state = !source
					? 'not configured'
					: enabled
						? 'ready'
						: 'off';
				const next = !source
					? 'Run /talk setup.'
					: enabled
						? 'Hold Space to dictate.'
						: 'Run /talk on.';
				ctx.ui.notify(
					`Talk\nState: ${state}\nKey: ${source ?? 'none'}\nNext: ${next}`,
					'info',
				);
				return;
			}
			ctx.ui.notify(
				'Use /talk setup, /talk on, /talk off, /talk forget, or /talk status.',
				'warning',
			);
		},
	});

	pi.on('session_shutdown', () => {
		deactivate();
		context = undefined;
	});
}
