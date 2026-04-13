import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import {
	Container,
	SettingsList,
	Text,
	type SettingItem,
} from '@mariozechner/pi-tui';
import {
	create_skills_manager,
	type ManagedSkill,
} from '../skills/manager.js';

const ENABLED = '[x]';
const DISABLED = '[ ]';

function sort_skills(skills: ManagedSkill[]): ManagedSkill[] {
	return [...skills].sort((a, b) => {
		const by_name = a.name.localeCompare(b.name);
		if (by_name !== 0) return by_name;
		const by_source = a.source.localeCompare(b.source);
		if (by_source !== 0) return by_source;
		return a.key.localeCompare(b.key);
	});
}

function format_skill_lines(
	skills: ManagedSkill[],
	options?: { heading?: string; show_enabled?: boolean },
): string {
	const sorted = sort_skills(skills);
	const lines: string[] = [];
	if (options?.heading) {
		lines.push(options.heading, '');
	}
	if (options?.show_enabled ?? true) {
		const on = sorted.filter((s) => s.enabled).length;
		const off = sorted.length - on;
		lines.push(
			`${sorted.length} skills (${on} enabled, ${off} disabled)`,
			'',
		);
	}

	for (const skill of sorted) {
		const prefix =
			options?.show_enabled === false
				? '-'
				: skill.enabled
					? ENABLED
					: DISABLED;
		lines.push(`${prefix} ${skill.name} (${skill.source})`);
		lines.push(`    key: ${skill.key}`);
		lines.push(`    ${skill.description.slice(0, 100)}`);
		if (skill.import_meta?.upstream_version) {
			lines.push(
				`    upstream: ${skill.import_meta.upstream_version}`,
			);
		}
	}

	return lines.join('\n');
}

function to_setting_item(skill: ManagedSkill): SettingItem {
	const detail_lines = [
		`${skill.source} • ${skill.key}`,
		skill.description,
		skill.baseDir,
	];
	if (skill.import_meta?.upstream_version) {
		detail_lines.push(
			`upstream: ${skill.import_meta.upstream_version}${skill.import_meta.upstream_git_commit_sha ? ` • ${skill.import_meta.upstream_git_commit_sha.slice(0, 12)}` : ''}`,
		);
	}

	return {
		id: skill.key,
		label: skill.name,
		description: detail_lines.join('\n'),
		currentValue: skill.enabled ? ENABLED : DISABLED,
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

// Default export for Pi Package / additionalExtensionPaths loading
export default async function skills(pi: ExtensionAPI) {
	const mgr = create_skills_manager();

	const subs = [
		'list',
		'discover',
		'available',
		'import',
		'sync',
		'enable',
		'disable',
		'toggle',
		'search',
		'refresh',
		'defaults',
	];

	pi.registerCommand('skills', {
		description: 'Manage pi-native skills and import external skills',
		getArgumentCompletions: (prefix) => {
			const parts = prefix.trim().split(/\s+/);
			if (parts.length <= 1) {
				return subs
					.filter((s) => s.startsWith(parts[0] || ''))
					.map((s) => ({ value: s, label: s }));
			}

			if (['enable', 'disable', 'toggle'].includes(parts[0])) {
				const q = parts.slice(1).join(' ').toLowerCase();
				return sort_skills(mgr.discover())
					.filter((s) => s.key.toLowerCase().includes(q))
					.slice(0, 20)
					.map((s) => ({
						value: `${parts[0]} ${s.key}`,
						label: `${s.key} ${s.enabled ? ENABLED : DISABLED}`,
					}));
			}

			if (parts[0] === 'import') {
				const q = parts.slice(1).join(' ').toLowerCase();
				return sort_skills(mgr.discover_importable())
					.filter(
						(s) =>
							s.key.toLowerCase().includes(q) ||
							s.name.toLowerCase().includes(q),
					)
					.slice(0, 20)
					.map((s) => ({
						value: `${parts[0]} ${s.key}`,
						label: s.key,
					}));
			}

			if (parts[0] === 'sync') {
				const q = parts.slice(1).join(' ').toLowerCase();
				return sort_skills(
					mgr
						.discover()
						.filter((skill) => Boolean(skill.import_meta)),
				)
					.filter(
						(s) =>
							s.key.toLowerCase().includes(q) ||
							s.name.toLowerCase().includes(q),
					)
					.slice(0, 20)
					.map((s) => ({
						value: `${parts[0]} ${s.key}`,
						label: s.key,
					}));
			}

			return null;
		},
		handler: async (args, ctx) => {
			const trimmed = args.trim();

			if (!trimmed && ctx.hasUI) {
				const discovered = sort_skills(mgr.discover());
				if (discovered.length === 0) {
					ctx.ui.notify(
						'No managed skills found. Use /skills available to inspect importable plugin skills.',
					);
					return;
				}

				const initial_enabled = new Set(
					discovered
						.filter((skill) => skill.enabled)
						.map((skill) => skill.key),
				);
				const current_enabled = new Set(initial_enabled);

				await ctx.ui.custom((tui, theme, _kb, done) => {
					const items = discovered.map(to_setting_item);
					const container = new Container();

					container.addChild({
						render: () => {
							const enabled = current_enabled.size;
							const disabled = discovered.length - enabled;
							return [
								theme.fg('accent', theme.bold('Skills')),
								theme.fg(
									'muted',
									`${enabled} enabled • ${disabled} disabled • managed pi-native skills only`,
								),
								'',
							];
						},
						invalidate: () => {},
					});

					const settings_list = new SettingsList(
						items,
						Math.min(Math.max(items.length + 4, 8), 18),
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
							if (new_value === ENABLED) {
								current_enabled.add(id);
								mgr.enable(id);
							} else {
								current_enabled.delete(id);
								mgr.disable(id);
							}
						},
						() => done(undefined),
						{ enableSearch: true },
					);

					container.addChild(settings_list);
					container.addChild(
						new Text(
							theme.fg(
								'dim',
								'esc close • search filters • /skills available shows importable plugin skills',
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
						'Reloading to apply updated skills...',
						'info',
					);
					await ctx.reload();
					return;
				}

				return;
			}

			const [sub, ...rest] = (trimmed || 'list').split(/\s+/);
			const arg = rest.join(' ');

			switch (sub) {
				case 'list':
				case 'discover': {
					const skills = mgr.discover();
					if (skills.length === 0) {
						ctx.ui.notify('No managed skills found');
						return;
					}
					ctx.ui.notify(
						format_skill_lines(skills, {
							heading: 'Managed skills',
						}),
					);
					break;
				}
				case 'available': {
					const skills = mgr.discover_importable();
					if (skills.length === 0) {
						ctx.ui.notify('No importable external skills found');
						return;
					}
					ctx.ui.notify(
						format_skill_lines(skills, {
							heading: 'Importable external skills',
							show_enabled: false,
						}),
					);
					break;
				}
				case 'import': {
					if (!arg) {
						ctx.ui.notify(
							'Usage: /skills import <key|name>',
							'warning',
						);
						return;
					}
					try {
						const result = mgr.import_skill(arg);
						ctx.ui.notify(
							`Imported ${arg} to ${result.skillDir}. Reloading...`,
							'info',
						);
						await ctx.reload();
						return;
					} catch (error) {
						ctx.ui.notify(
							error instanceof Error ? error.message : String(error),
							'warning',
						);
						return;
					}
				}
				case 'sync': {
					if (!arg) {
						ctx.ui.notify(
							'Usage: /skills sync <key|name>',
							'warning',
						);
						return;
					}
					try {
						const result = mgr.sync_skill(arg);
						ctx.ui.notify(
							result.changed
								? `Synced ${arg}. Reloading...`
								: `${arg} is already up to date.`,
							'info',
						);
						if (result.changed) {
							await ctx.reload();
						}
						return;
					} catch (error) {
						ctx.ui.notify(
							error instanceof Error ? error.message : String(error),
							'warning',
						);
						return;
					}
				}
				case 'enable': {
					if (!arg) {
						ctx.ui.notify('Usage: /skills enable <key>', 'warning');
						return;
					}
					mgr.enable(arg);
					ctx.ui.notify(`Enabled ${arg}. /reload to apply.`);
					break;
				}
				case 'disable': {
					if (!arg) {
						ctx.ui.notify('Usage: /skills disable <key>', 'warning');
						return;
					}
					mgr.disable(arg);
					ctx.ui.notify(`Disabled ${arg}. /reload to apply.`);
					break;
				}
				case 'toggle': {
					if (!arg) {
						ctx.ui.notify('Usage: /skills toggle <key>', 'warning');
						return;
					}
					const state = mgr.toggle(arg);
					ctx.ui.notify(
						`${arg} ${state ? 'enabled' : 'disabled'}. /reload to apply.`,
					);
					break;
				}
				case 'search': {
					if (!arg) {
						ctx.ui.notify('Usage: /skills search <query>', 'warning');
						return;
					}
					const results = mgr.search(arg);
					if (results.length === 0) {
						ctx.ui.notify(`No managed skills matching "${arg}"`);
						return;
					}
					ctx.ui.notify(
						format_skill_lines(results, {
							heading: `Managed skills matching "${arg}"`,
						}),
					);
					break;
				}
				case 'refresh': {
					mgr.refresh();
					ctx.ui.notify(
						`Rescanned: ${mgr.discover().length} managed skills, ${mgr.discover_importable().length} importable skills found`,
					);
					break;
				}
				case 'defaults': {
					if (arg !== 'all-enabled' && arg !== 'all-disabled') {
						ctx.ui.notify(
							'Usage: /skills defaults <all-enabled|all-disabled>',
							'warning',
						);
						return;
					}
					mgr.set_defaults(arg);
					ctx.ui.notify(`Default policy: ${arg}`);
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
}
