import type {
	ExtensionAPI,
	ExtensionContext,
} from '@earendil-works/pi-coding-agent';
import { Input, Key, matchesKey } from '@earendil-works/pi-tui';
import { Dictation } from './dictation.js';
import { HoldSpace } from './hold-space.js';
import {
	forget_talk_secrets,
	read_talk_secrets,
	write_talk_secrets,
} from './secrets.js';

export { HoldSpace } from './hold-space.js';
export {
	forget_talk_secrets,
	read_talk_secrets,
	write_talk_secrets,
} from './secrets.js';

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
			on_start: () => {
				if (dictation?.active) return false;
				dictation?.start();
				return dictation?.active ?? false;
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
