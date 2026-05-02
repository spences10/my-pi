import type { ExtensionAPI } from '@mariozechner/pi-coding-agent';
import {
	show_input_modal,
	show_text_modal,
} from '@spences10/pi-tui-modal';
import { create_skills_manager } from './manager.js';
import {
	find_skill,
	format_profile_detail,
	format_skill_detail,
	format_skill_list,
	profile_description,
	sort_skills,
} from './skill-utils.js';
import {
	pick_profile,
	pick_skill,
	show_defaults_modal,
	show_profiles_modal,
	show_refresh_summary,
	show_skill_detail_modal,
	show_skill_list_modal,
	show_skills_home_modal,
	show_skills_manager_modal,
} from './skills-ui.js';

export default async function skills(pi: ExtensionAPI) {
	const mgr = create_skills_manager();

	const subs = [
		'list',
		'show',
		'enable',
		'disable',
		'import',
		'sync',
		'profile',
		'refresh',
		'defaults',
	];

	pi.registerCommand('skills', {
		description: 'Manage pi-native skills and import external skills',
		getArgumentCompletions: (prefix) => {
			const parts = prefix.trimStart().split(/\s+/);
			const has_trailing_space = /\s$/.test(prefix);
			if (parts.length <= 1 && !has_trailing_space) {
				return subs
					.filter((s) => s.startsWith(parts[0] || ''))
					.map((s) => ({ value: s, label: s }));
			}

			if (['show', 'enable', 'disable'].includes(parts[0] ?? '')) {
				const q = parts.slice(1).join(' ').toLowerCase();
				const skills =
					parts[0] === 'show'
						? [...mgr.discover(), ...mgr.discover_importable()]
						: mgr.discover();
				return sort_skills(skills)
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

			if (parts[0] === 'profile') {
				const profile_subs = [
					'list',
					'show',
					'use',
					'create',
					'include',
					'exclude',
				];
				if (parts.length <= 2 && !has_trailing_space) {
					return profile_subs
						.filter((s) => s.startsWith(parts[1] || ''))
						.map((s) => ({ value: `profile ${s}`, label: s }));
				}
				if (
					['show', 'use', 'include', 'exclude'].includes(
						parts[1] ?? '',
					)
				) {
					const q = parts.slice(2).join(' ').toLowerCase();
					return mgr
						.list_profiles()
						.filter((profile) =>
							profile.name.toLowerCase().includes(q),
						)
						.slice(0, 20)
						.map((profile) => ({
							value: `profile ${parts[1]} ${profile.name}`,
							label: profile.name,
						}));
				}
			}

			return null;
		},
		handler: async (args, ctx) => {
			const trimmed = args.trim();

			if (!trimmed && ctx.hasUI) {
				while (true) {
					const managed_count = mgr.discover().length;
					const importable_count = mgr.discover_importable().length;
					const selected = await show_skills_home_modal(
						ctx,
						managed_count,
						importable_count,
						mgr.get_active_profile(),
					);
					if (!selected) return;

					if (selected === 'manage') {
						if (await show_skills_manager_modal(ctx, mgr)) return;
					} else if (selected === 'browse') {
						await show_skill_list_modal(ctx, mgr);
					} else if (selected === 'import') {
						const key = await pick_skill(ctx, {
							title: 'Import skill',
							subtitle:
								'Copy an external skill into Pi-native storage',
							skills: sort_skills(mgr.discover_importable()),
							empty_message: 'No importable skills found',
						});
						if (!key) continue;
						try {
							const result = mgr.import_skill(key);
							ctx.ui.notify(
								`Imported ${key} to ${result.skillDir}. Reloading...`,
								'info',
							);
							await ctx.reload();
							return;
						} catch (error) {
							ctx.ui.notify(
								error instanceof Error
									? error.message
									: String(error),
								'warning',
							);
						}
					} else if (selected === 'sync') {
						const key = await pick_skill(ctx, {
							title: 'Sync imported skill',
							subtitle:
								'Update an imported skill from its upstream source',
							skills: sort_skills(
								mgr
									.discover()
									.filter((skill) => Boolean(skill.import_meta)),
							),
							empty_message: 'No imported skills found',
						});
						if (!key) continue;
						try {
							const result = mgr.sync_skill(key);
							if (result.changed) {
								ctx.ui.notify(`Synced ${key}. Reloading...`, 'info');
								await ctx.reload();
								return;
							}
							await show_text_modal(ctx, {
								title: 'Skill already up to date',
								text: `${key} is already up to date.`,
							});
						} catch (error) {
							ctx.ui.notify(
								error instanceof Error
									? error.message
									: String(error),
								'warning',
							);
						}
					} else if (selected === 'profiles') {
						if (await show_profiles_modal(ctx, mgr)) return;
					} else if (selected === 'refresh') {
						await show_refresh_summary(ctx, mgr);
					} else if (selected === 'defaults') {
						await show_defaults_modal(ctx, mgr);
					}
				}
			}

			const [sub, ...rest] = (trimmed || 'list').split(/\s+/);
			const arg = rest.join(' ');

			switch (sub) {
				case 'list': {
					const skills = [
						...mgr.discover(),
						...mgr.discover_importable(),
					];
					if (ctx.hasUI) {
						await show_skill_list_modal(ctx, mgr);
					} else {
						ctx.ui.notify(format_skill_list(skills));
					}
					break;
				}
				case 'show': {
					const skills = [
						...mgr.discover(),
						...mgr.discover_importable(),
					];
					let target = arg;
					if (!target && ctx.hasUI) {
						target =
							(await pick_skill(ctx, {
								title: 'Show skill details',
								subtitle: 'Open a read-only skill detail view',
								skills: sort_skills(skills),
								empty_message: 'No skills found',
							})) ?? '';
						if (!target) return;
					}
					if (!target) {
						ctx.ui.notify(
							'Usage: /skills show <key|name>',
							'warning',
						);
						return;
					}
					try {
						const skill = find_skill(skills, target);
						if (ctx.hasUI) {
							await show_skill_detail_modal(ctx, skill);
						} else {
							ctx.ui.notify(format_skill_detail(skill));
						}
					} catch (error) {
						ctx.ui.notify(
							error instanceof Error ? error.message : String(error),
							'warning',
						);
					}
					break;
				}
				case 'enable':
				case 'disable': {
					let target = arg;
					if (!target && ctx.hasUI) {
						target =
							(await pick_skill(ctx, {
								title:
									sub === 'enable'
										? 'Enable skill in active profile'
										: 'Disable skill in active profile',
								subtitle: `Profile: ${mgr.get_active_profile()}`,
								skills: sort_skills(mgr.discover()),
								empty_message: 'No managed skills found',
							})) ?? '';
						if (!target) return;
					}
					if (!target) {
						ctx.ui.notify(
							`Usage: /skills ${sub} <key|name|pattern>`,
							'warning',
						);
						return;
					}
					let pattern = target;
					try {
						pattern = find_skill(mgr.discover(), target).key;
					} catch {
						// Treat misses as patterns, e.g. design-* or *@plugin:vendor.
					}
					if (sub === 'enable') mgr.enable(pattern);
					else mgr.disable(pattern);
					ctx.ui.notify(
						`Updated ${mgr.get_active_profile()} profile. Reloading...`,
						'info',
					);
					await ctx.reload();
					return;
				}
				case 'import': {
					let target = arg;
					if (!target && ctx.hasUI) {
						target =
							(await pick_skill(ctx, {
								title: 'Import skill',
								subtitle:
									'Copy an external skill into Pi-native storage',
								skills: sort_skills(mgr.discover_importable()),
								empty_message: 'No importable skills found',
							})) ?? '';
						if (!target) return;
					}
					if (!target) {
						ctx.ui.notify(
							'Usage: /skills import <key|name>',
							'warning',
						);
						return;
					}
					try {
						const result = mgr.import_skill(target);
						ctx.ui.notify(
							`Imported ${target} to ${result.skillDir}. Reloading...`,
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
					let target = arg;
					if (!target && ctx.hasUI) {
						target =
							(await pick_skill(ctx, {
								title: 'Sync imported skill',
								subtitle:
									'Update an imported skill from its upstream source',
								skills: sort_skills(
									mgr
										.discover()
										.filter((skill) => Boolean(skill.import_meta)),
								),
								empty_message: 'No imported skills found',
							})) ?? '';
						if (!target) return;
					}
					if (!target) {
						ctx.ui.notify(
							'Usage: /skills sync <key|name>',
							'warning',
						);
						return;
					}
					try {
						const result = mgr.sync_skill(target);
						if (result.changed) {
							ctx.ui.notify(`Synced ${target}. Reloading...`, 'info');
							await ctx.reload();
							return;
						}
						if (ctx.hasUI) {
							await show_text_modal(ctx, {
								title: 'Skill already up to date',
								text: `${target} is already up to date.`,
							});
						} else {
							ctx.ui.notify(
								`${target} is already up to date.`,
								'info',
							);
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
				case 'profile': {
					const [action = 'list', name, ...pattern_parts] = rest;
					const pattern = pattern_parts.join(' ');
					if (!args.trim().startsWith('profile') && ctx.hasUI) {
						if (await show_profiles_modal(ctx, mgr)) return;
						break;
					}
					if (action === 'list') {
						const text = mgr
							.list_profiles()
							.map(
								(profile) =>
									`${profile.active ? 'active' : '     '} ${profile.name} — ${profile_description(profile)}`,
							)
							.join('\n');
						if (ctx.hasUI) {
							await show_text_modal(ctx, {
								title: 'Skill profiles',
								text: text || 'No skill profiles found',
							});
						} else {
							ctx.ui.notify(text || 'No skill profiles found');
						}
						break;
					}
					if (action === 'show') {
						let target: string | undefined = name;
						if (!target && ctx.hasUI) {
							target = await pick_profile(
								ctx,
								mgr,
								'Show skill profile',
							);
						}
						const profile = mgr
							.list_profiles()
							.find((candidate) => candidate.name === target);
						if (!profile) {
							ctx.ui.notify(
								'Usage: /skills profile show <name>',
								'warning',
							);
							break;
						}
						if (ctx.hasUI) {
							await show_text_modal(ctx, {
								title: profile.name,
								text: format_profile_detail(profile),
							});
						} else {
							ctx.ui.notify(format_profile_detail(profile));
						}
						break;
					}
					if (action === 'use') {
						let target: string | undefined = name;
						if (!target && ctx.hasUI) {
							target = await pick_profile(
								ctx,
								mgr,
								'Use skill profile',
							);
						}
						if (!target) {
							ctx.ui.notify(
								'Usage: /skills profile use <name>',
								'warning',
							);
							break;
						}
						try {
							mgr.use_profile(target);
							ctx.ui.notify(
								`Using skill profile ${target}. Reloading...`,
								'info',
							);
							await ctx.reload();
							return;
						} catch (error) {
							ctx.ui.notify(
								error instanceof Error
									? error.message
									: String(error),
								'warning',
							);
						}
						break;
					}
					if (action === 'create') {
						let target: string | undefined = name;
						if (!target && ctx.hasUI) {
							target = await show_input_modal(ctx, {
								title: 'Create skill profile',
								label: 'Profile name',
								trim: true,
							});
						}
						if (!target) {
							ctx.ui.notify(
								'Usage: /skills profile create <name>',
								'warning',
							);
							break;
						}
						try {
							mgr.create_profile(target);
							ctx.ui.notify(`Created empty skill profile ${target}`);
						} catch (error) {
							ctx.ui.notify(
								error instanceof Error
									? error.message
									: String(error),
								'warning',
							);
						}
						break;
					}
					if (action === 'include' || action === 'exclude') {
						if (!name || !pattern) {
							ctx.ui.notify(
								`Usage: /skills profile ${action} <name> <pattern>`,
								'warning',
							);
							break;
						}
						try {
							if (action === 'include')
								mgr.include_in_profile(name, pattern);
							else mgr.exclude_from_profile(name, pattern);
							ctx.ui.notify(
								`Updated skill profile ${name}. Reloading...`,
								'info',
							);
							await ctx.reload();
							return;
						} catch (error) {
							ctx.ui.notify(
								error instanceof Error
									? error.message
									: String(error),
								'warning',
							);
						}
						break;
					}
					ctx.ui.notify(
						'Usage: /skills profile <list|show|use|create|include|exclude>',
						'warning',
					);
					break;
				}
				case 'refresh': {
					if (ctx.hasUI) {
						await show_refresh_summary(ctx, mgr);
						break;
					}
					mgr.refresh();
					ctx.ui.notify(
						`Rescanned: ${mgr.discover().length} managed skills, ${mgr.discover_importable().length} importable skills found`,
					);
					break;
				}
				case 'defaults': {
					if (!arg && ctx.hasUI) {
						await show_defaults_modal(ctx, mgr);
						break;
					}
					if (arg !== 'all-enabled' && arg !== 'all-disabled') {
						ctx.ui.notify(
							'Usage: /skills defaults <all-enabled|all-disabled>',
							'warning',
						);
						return;
					}
					mgr.set_defaults(arg);
					if (ctx.hasUI) {
						await show_text_modal(ctx, {
							title: 'Skill profile baseline updated',
							text: `Active profile baseline: ${arg}`,
						});
					} else {
						ctx.ui.notify(`Active profile baseline: ${arg}`);
					}
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
