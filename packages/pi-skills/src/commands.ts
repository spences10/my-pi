import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import {
	scan_importable_skills,
	scan_imported_skills,
} from '@spences10/pi-skill-importer';
import {
	run_with_progress_modal,
	show_confirm_modal,
	show_input_modal,
	show_text_modal,
} from '@spences10/pi-tui-modal';
import {
	get_skill_argument_completions,
	SKILL_SUBCOMMANDS,
} from './commands/completions.js';
import {
	has_gh_skill,
	parse_gh_skill_install_args,
	run_gh_skill_install,
	run_gh_skill_install_async,
	run_gh_skill_search,
	run_gh_skill_update,
	run_gh_skill_update_async,
} from './gh-skill.js';
import { create_skills_manager } from './manager.js';
import { is_resource_enabled } from './resource-discovery.js';
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
	show_add_github_skill_modal,
	show_add_import_modal,
	show_advanced_skills_modal,
	show_available_skills_modal,
	show_defaults_modal,
	show_installed_skills_modal,
	show_profiles_modal,
	show_refresh_summary,
	show_search_github_skills_modal,
	show_skill_detail_modal,
	show_skill_list_modal,
	show_skills_home_modal,
} from './skills-ui.js';

export default async function skills(pi: ExtensionAPI) {
	const mgr = create_skills_manager();

	pi.on('resources_discover', async (event) => {
		const resource_mgr = create_skills_manager({
			cwd: event.cwd,
			project_skills_enabled: is_resource_enabled(
				process.env.MY_PI_PROJECT_SKILLS,
			),
		});
		return { skillPaths: resource_mgr.get_enabled_skill_paths() };
	});

	pi.registerCommand('skills', {
		description: 'Manage and discover Pi skills',
		getArgumentCompletions: (prefix) =>
			get_skill_argument_completions(prefix, mgr),
		handler: async (args, ctx) => {
			const trimmed = args.trim();

			if (!trimmed && ctx.hasUI) {
				while (true) {
					const managed = mgr.discover();
					const selected = await show_skills_home_modal(
						ctx,
						{
							managed: managed.length,
							enabled: managed.filter((skill) => skill.enabled)
								.length,
							external: scan_importable_skills().length,
							imported: scan_imported_skills().length,
						},
						mgr.get_active_profile(),
					);
					if (!selected) break;
					if (selected === 'installed') {
						if (await show_installed_skills_modal(ctx, mgr)) return;
					} else if (selected === 'available') {
						if (await show_available_skills_modal(ctx)) return;
					} else if (selected === 'add-import') {
						if (await show_add_import_modal(ctx)) return;
					} else if (selected === 'advanced') {
						if (await show_advanced_skills_modal(ctx, mgr)) return;
					}
				}
				return;
			}

			const [sub, ...rest] = (trimmed || 'list').split(/\s+/);
			const arg = rest.join(' ');

			switch (sub) {
				case 'list': {
					const skills = mgr.discover();
					if (ctx.hasUI) {
						await show_skill_list_modal(ctx, mgr);
					} else {
						ctx.ui.notify(format_skill_list(skills));
					}
					break;
				}
				case 'show': {
					const skills = mgr.discover();
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
				case 'delete': {
					let targets = rest;
					if (!targets.length && ctx.hasUI) {
						const target = await pick_skill(ctx, {
							title: 'Delete skill',
							subtitle: 'Remove a managed skill directory from disk',
							skills: sort_skills(mgr.discover()),
							empty_message: 'No managed skills found',
						});
						if (!target) return;
						targets = [target];
					}
					if (!targets.length) {
						ctx.ui.notify(
							'Usage: /skills delete <key|name> [key|name...]',
							'warning',
						);
						return;
					}
					if (ctx.hasUI) {
						const ok = await show_confirm_modal(ctx, {
							title: 'Delete skills?',
							message: `Delete ${targets.length} skill${targets.length === 1 ? '' : 's'} from disk? This cannot be undone.`,
							confirm_label: 'Delete',
							cancel_label: 'Keep skills',
						});
						if (!ok) return;
					}
					let deleted = 0;
					for (const target of targets) {
						try {
							mgr.delete_skill(target);
							deleted += 1;
						} catch (error) {
							ctx.ui.notify(
								error instanceof Error
									? error.message
									: String(error),
								'warning',
							);
						}
					}
					if (deleted) {
						ctx.ui.notify(
							`Deleted ${deleted} skill${deleted === 1 ? '' : 's'}. Reloading...`,
							'info',
						);
						await ctx.reload();
						return;
					}
					break;
				}
				case 'search': {
					if (!arg && ctx.hasUI) {
						if (await show_search_github_skills_modal(ctx)) return;
						break;
					}
					if (!arg) {
						ctx.ui.notify('Usage: /skills search <query>', 'warning');
						return;
					}
					if (!has_gh_skill()) {
						ctx.ui.notify(
							'GitHub skill search requires gh v2.90.0+ with `gh skill` support.',
							'warning',
						);
						return;
					}
					try {
						const results = run_gh_skill_search(arg, 15);
						const lines = results.map(
							(result) =>
								`${result.skillName} — ${result.repo} (${result.stars}★)\n  ${result.path}\n  ${result.description}`,
						);
						ctx.ui.notify(
							lines.length
								? `GitHub skill search results for ${arg}:\n\n${lines.join('\n\n')}\n\nReview before installing. Preview: gh skill preview <repo> <path>\nInstall: /skills add <repo> <path>`
								: `Nothing found matching “${arg}”. Try a shorter query or run: gh skill search ${arg}`,
							lines.length ? 'info' : 'warning',
						);
					} catch (error) {
						ctx.ui.notify(
							error instanceof Error ? error.message : String(error),
							'warning',
						);
					}
					return;
				}
				case 'add': {
					if (!arg && ctx.hasUI) {
						if (await show_add_github_skill_modal(ctx)) return;
						break;
					}
					const gh_request = parse_gh_skill_install_args(rest);
					if (!gh_request) {
						ctx.ui.notify(
							'Usage: /skills add <owner/repo> <skill[@ref]> [--pin ref|--scope project|--dir path|--force]',
							'warning',
						);
						return;
					}
					if (!has_gh_skill()) {
						ctx.ui.notify(
							'GitHub skill adds require gh v2.90.0+ with `gh skill` support.',
							'warning',
						);
						return;
					}
					try {
						const output = ctx.hasUI
							? await run_with_progress_modal(
									ctx,
									{
										title: 'Adding GitHub skill',
										message: `Installing ${gh_request.skill} from ${gh_request.repository}`,
									},
									async ({ signal, update }) => {
										update({ current: gh_request.skill });
										return await run_gh_skill_install_async(
											gh_request,
											undefined,
											{ signal },
										);
									},
								)
							: run_gh_skill_install(gh_request);
						if (output === undefined) return;
						ctx.ui.notify(
							`${output || `Added ${gh_request.skill} from ${gh_request.repository}`}\nReloading...`,
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
				case 'update': {
					if (!has_gh_skill()) {
						ctx.ui.notify(
							'GitHub skill updates require gh v2.90.0+ with `gh skill` support.',
							'warning',
						);
						return;
					}
					try {
						const dry_run = rest.includes('--dry-run');
						const output = ctx.hasUI
							? await run_with_progress_modal(
									ctx,
									{
										title: dry_run
											? 'Checking GitHub skill updates'
											: 'Updating GitHub skills',
										message:
											`Running gh skill update ${rest.join(' ')}`.trim(),
									},
									async ({ signal }) =>
										await run_gh_skill_update_async(rest, undefined, {
											signal,
										}),
								)
							: run_gh_skill_update(rest);
						if (output === undefined) return;
						if (ctx.hasUI) {
							await show_text_modal(ctx, {
								title: dry_run
									? 'GitHub skill update check'
									: 'GitHub skills updated',
								text: output || 'No output from gh skill update.',
							});
						} else {
							ctx.ui.notify(output || 'gh skill update completed.');
						}
						if (!dry_run) {
							ctx.ui.notify('Reloading skills...', 'info');
							await ctx.reload();
							return;
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
						`Rescanned: ${mgr.discover().length} managed skills found`,
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
							title: 'Default skill policy updated',
							text: `Active profile now starts from: ${arg}`,
						});
					} else {
						ctx.ui.notify(`Default skill policy: ${arg}`);
					}
					break;
				}
				default:
					ctx.ui.notify(
						`Unknown: ${sub}. Use: ${SKILL_SUBCOMMANDS.join(', ')}`,
						'warning',
					);
			}
		},
	});
}
