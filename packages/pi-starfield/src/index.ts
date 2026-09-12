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

type EditorFactory = Parameters<
	ExtensionUIContext['setEditorComponent']
>[0];
const PACKAGE = 'pi-starfield';

function is_mode(value: unknown): value is StarfieldMode {
	return value === 'on' || value === 'static' || value === 'off';
}

export default function starfield(pi: ExtensionAPI): void {
	let mode: StarfieldMode = 'on';
	let editor: StarfieldEditor | undefined;
	let factory: EditorFactory;

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
		const settings = read_package_settings<{ mode?: unknown } | null>(
			PACKAGE,
			{},
		);
		mode = is_mode(settings?.mode) ? settings.mode : 'on';
		apply(ctx);
	});

	pi.registerCommand('starfield', {
		description: 'Input stars: /starfield on|static|off',
		handler: async (args, ctx) => {
			if (ctx.mode !== 'tui') return;
			const next = args.trim();
			if (!is_mode(next)) {
				ctx.ui.notify(
					`Starfield: ${mode}. Use /starfield on|static|off.`,
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
			try {
				write_package_settings(PACKAGE, { mode });
				ctx.ui.notify(`Starfield: ${mode}.`, 'info');
			} catch (error) {
				ctx.ui.notify(
					`Starfield changed for this session but could not save settings: ${String(error)}`,
					'error',
				);
			}
		},
	});

	pi.on('session_shutdown', (_event, ctx) => {
		if (ctx.mode === 'tui') uninstall(ctx);
	});
}
