import type {
	ExtensionAPI,
	ExtensionCommandContext,
} from '@earendil-works/pi-coding-agent';
import { show_settings_modal } from '@spences10/pi-tui-modal';
import { EXTENSIONS, type MyPiExtension } from './extensions.js';
import { is_enabled, set_enabled } from './settings.js';

const ENABLED = '● enabled';
const DISABLED = '○ disabled';
const SUBCOMMANDS = ['list', 'enable', 'disable'];

function find_extension(query: string): MyPiExtension | undefined {
	const q = query.trim().toLowerCase();
	return EXTENSIONS.find(
		(extension) =>
			extension.key === q || extension.label.toLowerCase() === q,
	);
}

export function format_list(): string {
	return EXTENSIONS.map(
		(extension) =>
			`${is_enabled(extension.key) ? ENABLED : DISABLED}  ${extension.key}  ${extension.description}`,
	).join('\n');
}

async function show_manager(
	ctx: ExtensionCommandContext,
): Promise<void> {
	const before = EXTENSIONS.map((extension) =>
		is_enabled(extension.key),
	).join();
	await show_settings_modal(ctx, {
		title: 'my-pi extensions',
		items: EXTENSIONS.map((extension) => ({
			id: extension.key,
			label: extension.label,
			description: `${extension.key}\n${extension.description}`,
			currentValue: is_enabled(extension.key) ? ENABLED : DISABLED,
			values: [ENABLED, DISABLED],
		})),
		enable_search: true,
		footer: 'esc close • changes save immediately',
		on_change: (id, value) => set_enabled(id, value === ENABLED),
	});
	const after = EXTENSIONS.map((extension) =>
		is_enabled(extension.key),
	).join();
	if (before !== after) {
		ctx.ui.notify('Reloading to apply extension changes...', 'info');
		await ctx.reload();
	}
}

export default function extensions_manager(pi: ExtensionAPI): void {
	pi.registerCommand('extensions', {
		description: 'Turn my-pi extensions on or off',
		getArgumentCompletions: (prefix) => {
			const [sub = '', query = ''] = prefix.trimStart().split(/\s+/);
			if (!['enable', 'disable'].includes(sub)) {
				return SUBCOMMANDS.filter((name) => name.startsWith(sub)).map(
					(name) => ({ value: name, label: name }),
				);
			}
			return EXTENSIONS.filter((extension) =>
				extension.key.startsWith(query),
			).map((extension) => ({
				value: `${sub} ${extension.key}`,
				label: extension.key,
			}));
		},
		handler: async (args, ctx) => {
			const [sub, ...rest] = args.trim().split(/\s+/);
			if (!sub && ctx.hasUI) return show_manager(ctx);
			if (!sub || sub === 'list') {
				ctx.ui.notify(format_list());
				return;
			}
			if (sub !== 'enable' && sub !== 'disable') {
				ctx.ui.notify(
					`Usage: /extensions [${SUBCOMMANDS.join('|')}] [key]`,
					'warning',
				);
				return;
			}
			const extension = find_extension(rest.join(' '));
			if (!extension) {
				ctx.ui.notify(
					`Unknown extension. Keys: ${EXTENSIONS.map((item) => item.key).join(', ')}`,
					'warning',
				);
				return;
			}
			set_enabled(extension.key, sub === 'enable');
			ctx.ui.notify(`${extension.key} ${sub}d. Reloading...`, 'info');
			await ctx.reload();
		},
	});
}
