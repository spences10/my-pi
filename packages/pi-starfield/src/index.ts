import type {
	ExtensionAPI,
	ExtensionContext,
	ExtensionUIContext,
} from '@earendil-works/pi-coding-agent';
import {
	read_package_settings,
	write_package_settings,
} from '@spences10/pi-settings';
import { StarfieldEditor, type StarfieldMode } from './editor.js';
import { clean_suggestion, suggestion_context } from './suggest.js';

type EditorFactory = Parameters<
	ExtensionUIContext['setEditorComponent']
>[0];
const PACKAGE = 'pi-starfield';

function is_mode(value: unknown): value is StarfieldMode {
	return value === 'on' || value === 'static' || value === 'off';
}

export default function starfield(pi: ExtensionAPI): void {
	let mode: StarfieldMode = 'on';
	let suggest = true;
	let suggestion: string | undefined;
	let suggestion_abort: AbortController | undefined;
	let editor: StarfieldEditor | undefined;
	let factory: EditorFactory;

	function clear_suggestion(): void {
		suggestion_abort?.abort();
		suggestion_abort = undefined;
		suggestion = undefined;
	}

	function save(ctx: ExtensionContext): boolean {
		try {
			write_package_settings(PACKAGE, { mode, suggest });
			return true;
		} catch (error) {
			ctx.ui.notify(
				`Starfield changed for this session but could not save settings: ${String(error)}`,
				'error',
			);
			return false;
		}
	}

	function uninstall(ctx: ExtensionContext): void {
		editor?.dispose();
		editor = undefined;
		if (factory && ctx.ui.getEditorComponent() === factory)
			ctx.ui.setEditorComponent(undefined);
		factory = undefined;
	}

	function apply(ctx: ExtensionContext): boolean {
		if (mode === 'off') {
			uninstall(ctx);
			return true;
		}
		const current = ctx.ui.getEditorComponent();
		if (current && current !== factory) {
			editor?.dispose();
			ctx.ui.notify(
				'Starfield did not replace another custom editor. Disable that editor first.',
				'warning',
			);
			return false;
		}
		if (current && current === factory) {
			editor?.refresh();
			return true;
		}
		factory = (tui, theme, keybindings) => {
			editor?.dispose();
			editor = new StarfieldEditor(tui, theme, keybindings, {
				theme: () => ctx.ui.theme,
				mode: () => mode,
				active: () => ctx.ui.getEditorComponent() === factory,
				suggestion: () => (suggest ? suggestion : undefined),
				on_accept_suggestion: clear_suggestion,
			});
			return editor;
		};
		ctx.ui.setEditorComponent(factory);
		return true;
	}

	pi.on('session_start', (_event, ctx) => {
		if (ctx.mode !== 'tui') return;
		uninstall(ctx);
		if (
			process.env.TERM === 'dumb' ||
			process.env.NO_COLOR !== undefined
		)
			return;
		const settings = read_package_settings<{
			mode?: unknown;
			suggest?: unknown;
		} | null>(PACKAGE, {});
		mode = is_mode(settings?.mode) ? settings.mode : 'on';
		suggest = settings?.suggest !== false;
		apply(ctx);
	});

	pi.on('agent_start', () => {
		clear_suggestion();
		editor?.refresh();
	});

	pi.on('agent_end', (event, ctx) => {
		if (
			ctx.mode !== 'tui' ||
			!suggest ||
			mode === 'off' ||
			!ctx.model
		)
			return;
		const context = suggestion_context(event.messages);
		if (!context) return;
		clear_suggestion();
		const controller = new AbortController();
		suggestion_abort = controller;
		// Fire and forget: a failed suggestion just leaves the input empty.
		void ctx.modelRegistry
			.streamSimple(ctx.model, context, {
				maxTokens: 60,
				signal: controller.signal,
			})
			.result()
			.then((message) => {
				if (controller.signal.aborted) return;
				const text = message.content
					.flatMap((block) =>
						block.type === 'text' ? [block.text] : [],
					)
					.join('');
				suggestion = clean_suggestion(text);
				suggestion_abort = undefined;
				editor?.refresh();
			})
			.catch(() => {});
	});

	pi.registerCommand('starfield', {
		description:
			'Input stars: /starfield on|static|off, /starfield suggest on|off',
		handler: async (args, ctx) => {
			if (ctx.mode !== 'tui') return;
			const [first, second] = args.trim().split(/\s+/);
			if (first === 'suggest') {
				if (second !== 'on' && second !== 'off') {
					ctx.ui.notify(
						`Suggestions: ${suggest ? 'on' : 'off'}. Use /starfield suggest on|off.`,
						'info',
					);
					return;
				}
				suggest = second === 'on';
				if (!suggest) clear_suggestion();
				editor?.refresh();
				if (save(ctx))
					ctx.ui.notify(`Suggestions: ${second}.`, 'info');
				return;
			}
			const next = first ?? '';
			if (!is_mode(next)) {
				ctx.ui.notify(
					`Starfield: ${mode}, suggestions ${suggest ? 'on' : 'off'}. Use /starfield on|static|off or /starfield suggest on|off.`,
					'info',
				);
				return;
			}
			if (
				next !== 'off' &&
				(process.env.TERM === 'dumb' ||
					process.env.NO_COLOR !== undefined)
			) {
				ctx.ui.notify(
					'Starfield is disabled by TERM=dumb or NO_COLOR.',
					'warning',
				);
				return;
			}
			const previous = mode;
			mode = next;
			if (!apply(ctx)) {
				mode = previous;
				return;
			}
			if (save(ctx)) ctx.ui.notify(`Starfield: ${mode}.`, 'info');
		},
	});

	pi.on('session_shutdown', (_event, ctx) => {
		clear_suggestion();
		if (ctx.mode === 'tui') uninstall(ctx);
	});
}
