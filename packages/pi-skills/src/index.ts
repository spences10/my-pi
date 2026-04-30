import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import { type SettingItem } from '@mariozechner/pi-tui';
import { show_settings_modal } from '@spences10/pi-tui-modal';
import {
	create_skills_manager,
	type ManagedSkill,
} from './manager.js';

export { create_skills_manager } from './manager.js';
export type { ManagedSkill, SkillsManager } from './manager.js';

const ENABLED = '● enabled';
const DISABLED = '○ disabled';
const SYNC = '↻ sync';
const IMPORTED_LABEL = '✓ imported';

function sort_skills(skills: ManagedSkill[]): ManagedSkill[] {
	return [...skills].sort((a, b) => {
		const by_name = a.name.localeCompare(b.name);
		if (by_name !== 0) return by_name;
		const by_source = a.source.localeCompare(b.source);
		if (by_source !== 0) return by_source;
		return a.key.localeCompare(b.key);
	});
}

function find_matching_imported_skill(
	managed_skills: ManagedSkill[],
	skill: ManagedSkill,
): ManagedSkill | undefined {
	const exact_match = managed_skills.find(
		(candidate) =>
			candidate.import_meta?.source === skill.source &&
			(candidate.import_meta.upstream_skill_path ===
				skill.skillPath ||
				candidate.import_meta.upstream_base_dir === skill.baseDir),
	);
	if (exact_match) return exact_match;

	return managed_skills.find(
		(candidate) =>
			candidate.import_meta?.source === skill.source &&
			candidate.name === skill.name,
	);
}

function get_importable_state(
	managed_skills: ManagedSkill[],
	skill: ManagedSkill,
): {
	label: string;
	detail: string;
	action: 'import' | 'sync' | null;
} {
	const imported = find_matching_imported_skill(
		managed_skills,
		skill,
	);
	if (imported?.import_meta) {
		const version_changed = Boolean(
			skill.plugin?.version &&
			imported.import_meta.upstream_version &&
			skill.plugin.version !== imported.import_meta.upstream_version,
		);
		const sha_changed = Boolean(
			skill.plugin?.gitCommitSha &&
			imported.import_meta.upstream_git_commit_sha &&
			skill.plugin.gitCommitSha !==
				imported.import_meta.upstream_git_commit_sha,
		);

		if (version_changed || sha_changed) {
			return {
				label: 'sync',
				detail: 'Press Enter to sync the imported copy and reload',
				action: 'sync',
			};
		}

		return {
			label: 'imported',
			detail: `Already imported to ${imported.baseDir}`,
			action: null,
		};
	}

	const managed_conflict = managed_skills.find(
		(candidate) => candidate.name === skill.name,
	);
	if (managed_conflict) {
		return {
			label: 'managed',
			detail: `Already managed at ${managed_conflict.baseDir}`,
			action: null,
		};
	}

	return {
		label: 'import',
		detail: 'Press Enter to import into pi-native skills and reload',
		action: 'import',
	};
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

function to_importable_setting_item(
	managed_skills: ManagedSkill[],
	skill: ManagedSkill,
): SettingItem {
	const state = get_importable_state(managed_skills, skill);
	const detail_lines = [
		`${skill.source} • ${skill.key}`,
		skill.description,
		skill.baseDir,
	];
	if (skill.plugin?.version) {
		detail_lines.push(
			`plugin: ${skill.plugin.version}${skill.plugin.gitCommitSha ? ` • ${skill.plugin.gitCommitSha.slice(0, 12)}` : ''}`,
		);
	}

	if (state.action === 'import') {
		return {
			id: skill.key,
			label: skill.name,
			description: detail_lines.join('\n'),
			currentValue: DISABLED,
			values: [ENABLED, DISABLED],
		};
	}

	if (state.action === 'sync') {
		detail_lines.push('enter to sync');
		return {
			id: skill.key,
			label: skill.name,
			description: detail_lines.join('\n'),
			currentValue: SYNC,
			values: [SYNC],
		};
	}

	detail_lines.push(state.detail);
	return {
		id: skill.key,
		label: skill.name,
		description: detail_lines.join('\n'),
		currentValue: IMPORTED_LABEL,
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

	const subs = ['import', 'sync', 'refresh', 'defaults'];

	pi.registerCommand('skills', {
		description: 'Manage pi-native skills and import external skills',
		getArgumentCompletions: (prefix) => {
			const parts = prefix.trim().split(/\s+/);
			if (parts.length <= 1) {
				return subs
					.filter((s) => s.startsWith(parts[0] || ''))
					.map((s) => ({ value: s, label: s }));
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
				const importable = sort_skills(mgr.discover_importable());
				if (discovered.length === 0 && importable.length === 0) {
					ctx.ui.notify('No managed or importable skills found');
					return;
				}

				const initial_enabled = new Set(
					discovered
						.filter((skill) => skill.enabled)
						.map((skill) => skill.key),
				);
				const current_enabled = new Set(initial_enabled);
				const queued_imports = new Set<string>();
				let reload_notice: string | null = null;

				const managed_items = discovered.map(to_setting_item);
				const importable_items = importable.map((skill) =>
					to_importable_setting_item(discovered, skill),
				);

				const all_items: SettingItem[] = [];
				if (managed_items.length > 0) {
					all_items.push({
						id: '__header_managed__',
						label: `── Managed (${managed_items.length}) ──`,
						description: '',
						currentValue: '',
					});
					all_items.push(...managed_items);
				}
				if (importable_items.length > 0) {
					all_items.push({
						id: '__header_importable__',
						label: `── Importable (${importable_items.length}) ──`,
						description: '',
						currentValue: '',
					});
					all_items.push(...importable_items);
				}

				const managed_keys = new Set(discovered.map((s) => s.key));
				const importable_map = new Map(
					importable.map((s) => [s.key, s]),
				);

				await show_settings_modal(ctx, {
					title: 'Skills',
					subtitle: () => {
						const enabled = current_enabled.size;
						const disabled = discovered.length - enabled;
						const queued = queued_imports.size;
						const parts = [
							`${enabled} enabled`,
							`${disabled} disabled`,
						];
						if (importable.length > 0) {
							parts.push(`${importable.length} importable`);
						}
						if (queued > 0) {
							parts.push(`${queued} queued for import`);
						}
						return parts.join(' • ');
					},
					items: all_items,
					max_visible: Math.min(
						Math.max(all_items.length + 4, 8),
						22,
					),
					enable_search: true,
					on_change: (id, new_value) => {
						if (id.startsWith('__header_')) return;

						if (managed_keys.has(id)) {
							if (new_value === ENABLED) {
								current_enabled.add(id);
								mgr.enable(id);
							} else {
								current_enabled.delete(id);
								mgr.disable(id);
							}
							return;
						}

						const import_skill = importable_map.get(id);
						if (!import_skill) return;

						const state = get_importable_state(
							discovered,
							import_skill,
						);

						if (state.action === 'import') {
							if (new_value === ENABLED) {
								queued_imports.add(id);
							} else {
								queued_imports.delete(id);
							}
							return;
						}

						if (state.action === 'sync') {
							const imported_skill = find_matching_imported_skill(
								discovered,
								import_skill,
							);
							if (!imported_skill) {
								ctx.ui.notify(
									`Imported copy for ${import_skill.name} was not found`,
									'warning',
								);
								return;
							}

							try {
								const result = mgr.sync_skill(imported_skill.key);
								if (result.changed) {
									reload_notice = `Synced ${import_skill.name}. Reloading...`;
									return true;
								} else {
									ctx.ui.notify(
										`${import_skill.name} is already up to date.`,
										'info',
									);
								}
							} catch (error) {
								ctx.ui.notify(
									error instanceof Error
										? error.message
										: String(error),
									'warning',
								);
							}
						}
					},
				});

				if (queued_imports.size > 0) {
					const imported_names: string[] = [];
					for (const key of queued_imports) {
						try {
							mgr.import_skill(key);
							imported_names.push(key);
						} catch (error) {
							ctx.ui.notify(
								error instanceof Error
									? error.message
									: String(error),
								'warning',
							);
						}
					}
					if (imported_names.length > 0) {
						reload_notice = `Imported ${imported_names.length} skill(s). Reloading...`;
					}
				}

				if (reload_notice) {
					ctx.ui.notify(reload_notice, 'info');
					await ctx.reload();
					return;
				}

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
