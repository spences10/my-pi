import type {
	ExtensionAPI,
	ExtensionCommandContext,
} from '@mariozechner/pi-coding-agent';
import {
	Container,
	SettingsList,
	Text,
	type SettingItem,
} from '@mariozechner/pi-tui';
import {
	BUILTIN_EXTENSIONS,
	find_builtin_extension,
	load_builtin_extensions_config,
	resolve_builtin_extension_states,
	save_builtin_extensions_config,
	type BuiltinExtensionKey,
	type BuiltinExtensionState,
} from './config.js';

const ENABLED = '[x]';
const DISABLED = '[ ]';

export interface ExtensionsManagerOptions {
	force_disabled?: Iterable<BuiltinExtensionKey>;
}

function to_force_disabled_set(
	force_disabled?: Iterable<BuiltinExtensionKey>,
): ReadonlySet<BuiltinExtensionKey> {
	return new Set(force_disabled ?? []);
}

function format_effective_state(
	state: BuiltinExtensionState,
): string {
	if (state.effective_enabled) {
		return 'enabled';
	}
	if (state.forced_disabled) {
		return `disabled in this process by ${state.cli_flag}`;
	}
	return 'disabled';
}

function format_extension_lines(
	states: BuiltinExtensionState[],
	options?: { heading?: string },
): string {
	const lines: string[] = [];
	if (options?.heading) {
		lines.push(options.heading, '');
	}

	const enabled_now = states.filter(
		(state) => state.effective_enabled,
	).length;
	const disabled_now = states.length - enabled_now;
	lines.push(
		`${states.length} built-in extensions (${enabled_now} enabled now, ${disabled_now} disabled now)`,
		'',
	);

	for (const state of states) {
		lines.push(
			`${state.saved_enabled ? ENABLED : DISABLED} ${state.label}`,
		);
		lines.push(`    key: ${state.key}`);
		lines.push(
			`    saved config: ${state.saved_enabled ? 'enabled' : 'disabled'}`,
		);
		lines.push(
			`    current process: ${format_effective_state(state)}`,
		);
		lines.push(`    ${state.description}`);
	}

	return lines.join('\n');
}

function to_setting_item(state: BuiltinExtensionState): SettingItem {
	const detail_lines = [
		state.key,
		state.description,
		`current process: ${format_effective_state(state)}`,
		`startup override: ${state.cli_flag}`,
	];

	return {
		id: state.key,
		label: state.label,
		description: detail_lines.join('\n'),
		currentValue: state.saved_enabled ? ENABLED : DISABLED,
		values: [ENABLED, DISABLED],
	};
}

function sets_equal(
	a: ReadonlySet<string>,
	b: ReadonlySet<string>,
): boolean {
	if (a.size !== b.size) return false;
	for (const value of a) {
		if (!b.has(value)) return false;
	}
	return true;
}

function search_states(
	states: BuiltinExtensionState[],
	query: string,
): BuiltinExtensionState[] {
	const normalized = query.trim().toLowerCase();
	if (!normalized) return states;

	return states.filter((state) =>
		[
			state.key,
			state.label,
			state.description,
			...state.aliases,
		].some((value) => value.toLowerCase().includes(normalized)),
	);
}

function save_extension_enabled(
	key: BuiltinExtensionKey,
	enabled: boolean,
): void {
	const config = load_builtin_extensions_config();
	config.enabled[key] = enabled;
	save_builtin_extensions_config(config);
}

export function create_extensions_extension(
	options: ExtensionsManagerOptions = {},
) {
	const force_disabled = to_force_disabled_set(
		options.force_disabled,
	);

	async function show_manager(
		ctx: ExtensionCommandContext,
	): Promise<boolean> {
		if (!ctx.hasUI) return false;

		const states = resolve_builtin_extension_states(force_disabled);
		const initial_enabled = new Set(
			states
				.filter((state) => state.saved_enabled)
				.map((state) => state.key),
		);
		const current_enabled = new Set(initial_enabled);

		await ctx.ui.custom((tui, theme, _kb, done) => {
			const items = states.map(to_setting_item);
			const container = new Container();

			container.addChild({
				render: () => {
					const saved_enabled = current_enabled.size;
					const saved_disabled = states.length - saved_enabled;
					const enabled_now = [...current_enabled].filter(
						(key) => !force_disabled.has(key as BuiltinExtensionKey),
					).length;
					const disabled_now = states.length - enabled_now;
					return [
						theme.fg('accent', theme.bold('Built-in extensions')),
						theme.fg(
							'muted',
							`${saved_enabled} saved enabled • ${saved_disabled} saved disabled • ${enabled_now} enabled now • ${disabled_now} disabled now`,
						),
						'',
					];
				},
				invalidate: () => {},
			});

			const settings_list = new SettingsList(
				items,
				Math.min(Math.max(items.length + 4, 8), 16),
				{
					cursor: theme.fg('accent', '›'),
					label: (text, selected) =>
						selected ? theme.fg('accent', text) : text,
					value: (text, selected) => {
						const color = text === ENABLED ? 'success' : 'dim';
						const rendered = theme.fg(color, text);
						return selected
							? theme.bold(theme.fg('accent', rendered))
							: rendered;
					},
					description: (text) => theme.fg('muted', text),
					hint: (text) => theme.fg('dim', text),
				},
				(id, new_value) => {
					const key = id as BuiltinExtensionKey;
					const enabled = new_value === ENABLED;
					if (enabled) {
						current_enabled.add(key);
					} else {
						current_enabled.delete(key);
					}
					save_extension_enabled(key, enabled);
				},
				() => done(undefined),
				{ enableSearch: true },
			);

			container.addChild(settings_list);
			container.addChild(
				new Text(
					theme.fg(
						'dim',
						'esc close • search filters • changes save immediately • CLI --no-* flags still win in this process',
					),
					0,
					1,
				),
			);

			return {
				render(width: number) {
					return container.render(width);
				},
				invalidate() {
					container.invalidate();
				},
				handleInput(data: string) {
					settings_list.handleInput(data);
					tui.requestRender();
				},
			};
		});

		if (!sets_equal(initial_enabled, current_enabled)) {
			ctx.ui.notify(
				force_disabled.size > 0
					? 'Reloading to apply updated built-in extensions. CLI --no-* flags still force-disable some extensions in this process.'
					: 'Reloading to apply updated built-in extensions...',
				'info',
			);
			await ctx.reload();
		}

		return true;
	}

	return async function extensions(pi: ExtensionAPI) {
		const subs = ['list', 'enable', 'disable', 'toggle', 'search'];

		pi.registerCommand('extensions', {
			description: 'Manage built-in my-pi extensions',
			getArgumentCompletions: (prefix) => {
				const parts = prefix.trim().split(/\s+/);
				if (parts.length <= 1) {
					return subs
						.filter((sub) => sub.startsWith(parts[0] || ''))
						.map((sub) => ({ value: sub, label: sub }));
				}

				if (['enable', 'disable', 'toggle'].includes(parts[0])) {
					const q = parts.slice(1).join(' ').toLowerCase();
					return resolve_builtin_extension_states(force_disabled)
						.filter(
							(state) =>
								state.key.toLowerCase().includes(q) ||
								state.label.toLowerCase().includes(q),
						)
						.slice(0, 20)
						.map((state) => ({
							value: `${parts[0]} ${state.key}`,
							label: `${state.key} ${state.saved_enabled ? ENABLED : DISABLED}`,
						}));
				}

				return null;
			},
			handler: async (args, ctx) => {
				const trimmed = args.trim();

				if (!trimmed) {
					if (await show_manager(ctx)) return;
				}

				const [sub, ...rest] = (trimmed || 'list').split(/\s+/);
				const arg = rest.join(' ');
				const states =
					resolve_builtin_extension_states(force_disabled);

				switch (sub) {
					case 'list': {
						ctx.ui.notify(
							format_extension_lines(states, {
								heading: 'Built-in extensions',
							}),
						);
						break;
					}
					case 'enable':
					case 'disable':
					case 'toggle': {
						if (!arg) {
							if (await show_manager(ctx)) return;
							ctx.ui.notify(
								`Usage: /extensions ${sub} <key>`,
								'warning',
							);
							return;
						}

						const extension = find_builtin_extension(arg);
						if (!extension) {
							ctx.ui.notify(
								`Unknown extension: ${arg}. Use: ${BUILTIN_EXTENSIONS.map((item) => item.key).join(', ')}`,
								'warning',
							);
							return;
						}

						const current_state = states.find(
							(state) => state.key === extension.key,
						);
						const next_enabled =
							sub === 'enable'
								? true
								: sub === 'disable'
									? false
									: !current_state?.saved_enabled;
						save_extension_enabled(extension.key, next_enabled);

						ctx.ui.notify(
							next_enabled && force_disabled.has(extension.key)
								? `Enabled ${extension.key} in saved config. Still disabled in this process by ${extension.cli_flag}. /reload or restart without that flag to apply.`
								: `${extension.key} ${next_enabled ? 'enabled' : 'disabled'}. /reload to apply.`,
						);
						break;
					}
					case 'search': {
						if (!arg) {
							ctx.ui.notify(
								'Usage: /extensions search <query>',
								'warning',
							);
							return;
						}
						const results = search_states(states, arg);
						if (results.length === 0) {
							ctx.ui.notify(
								`No built-in extensions matching "${arg}"`,
							);
							return;
						}
						ctx.ui.notify(
							format_extension_lines(results, {
								heading: `Built-in extensions matching "${arg}"`,
							}),
						);
						break;
					}
					default:
						ctx.ui.notify(
							`Unknown: ${sub}. Use: ${subs.join(', ')}`,
							'warning',
						);
				}
			},
		});
	};
}

export default create_extensions_extension();
