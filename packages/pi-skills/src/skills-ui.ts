import type { ExtensionCommandContext } from '@mariozechner/pi-coding-agent';
import { type SettingItem } from '@mariozechner/pi-tui';
import {
	show_input_modal,
	show_picker_modal,
	show_settings_modal,
	show_text_modal,
} from '@spences10/pi-tui-modal';
import type { ManagedSkill, SkillsManager } from './manager.js';
import {
	ENABLED,
	find_matching_imported_skill,
	find_skill,
	format_profile_detail,
	format_skill_detail,
	get_importable_state,
	profile_description,
	sets_equal,
	skill_status,
	sort_skills,
	to_importable_setting_item,
	to_setting_item,
} from './skill-utils.js';

export async function show_skills_home_modal(
	ctx: ExtensionCommandContext,
	managed_count: number,
	importable_count: number,
	active_profile: string,
): Promise<string | undefined> {
	return await show_picker_modal(ctx, {
		title: 'Skills',
		subtitle: `${managed_count} managed • ${importable_count} importable • profile ${active_profile}`,
		items: [
			{
				value: 'manage',
				label: 'Manage skills',
				description: 'Enable, disable, import, and sync skills',
			},
			{
				value: 'browse',
				label: 'Browse details',
				description:
					'Open read-only detail views for discovered skills',
			},
			{
				value: 'import',
				label: 'Import skill',
				description: 'Copy an external skill into Pi-native storage',
			},
			{
				value: 'sync',
				label: 'Sync imported skill',
				description:
					'Update an imported skill from its upstream source',
			},
			{
				value: 'profiles',
				label: 'Profiles',
				description: 'Create and switch named skill sets',
			},
			{
				value: 'refresh',
				label: 'Refresh discovery',
				description: 'Rescan managed and importable skills',
			},
			{
				value: 'defaults',
				label: 'Profile baseline',
				description:
					'Choose whether this profile starts enabled or disabled',
			},
		],
		footer: 'enter opens • esc close/back',
	});
}

export async function show_skills_manager_modal(
	ctx: ExtensionCommandContext,
	mgr: SkillsManager,
): Promise<boolean> {
	const discovered = sort_skills(mgr.discover());
	const importable = sort_skills(mgr.discover_importable());
	if (discovered.length === 0 && importable.length === 0) {
		ctx.ui.notify('No managed or importable skills found');
		return false;
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

	const metadata_by_id = new Map(
		all_items.map((item) => [item.id, item.description ?? '']),
	);
	for (const item of all_items) {
		if (!item.id.startsWith('__header_')) item.description = '';
	}

	const managed_keys = new Set(discovered.map((skill) => skill.key));
	const importable_map = new Map(
		importable.map((skill) => [skill.key, skill]),
	);

	await show_settings_modal(ctx, {
		title: 'Skills',
		subtitle: () => {
			const enabled = current_enabled.size;
			const disabled = discovered.length - enabled;
			const queued = queued_imports.size;
			const parts = [
				`profile ${mgr.get_active_profile()}`,
				`${enabled} enabled`,
				`${disabled} disabled`,
			];
			if (importable.length > 0)
				parts.push(`${importable.length} importable`);
			if (queued > 0) parts.push(`${queued} queued for import`);
			return parts.join(' • ');
		},
		items: all_items,
		max_visible: Math.min(Math.max(all_items.length + 4, 8), 12),
		enable_search: true,
		metadata: (item) =>
			item ? metadata_by_id.get(item.id)?.split('\n') : undefined,
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

			const state = get_importable_state(discovered, import_skill);
			if (state.action === 'import') {
				if (new_value === ENABLED) queued_imports.add(id);
				else queued_imports.delete(id);
				return;
			}

			if (state.action !== 'sync') return;
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
				}
				ctx.ui.notify(
					`${import_skill.name} is already up to date.`,
					'info',
				);
			} catch (error) {
				ctx.ui.notify(
					error instanceof Error ? error.message : String(error),
					'warning',
				);
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
					error instanceof Error ? error.message : String(error),
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
		return true;
	}

	if (!sets_equal(initial_enabled, current_enabled)) {
		ctx.ui.notify('Reloading to apply updated skills...', 'info');
		await ctx.reload();
		return true;
	}

	return false;
}

export async function pick_skill(
	ctx: ExtensionCommandContext,
	options: {
		title: string;
		subtitle: string;
		skills: ManagedSkill[];
		empty_message: string;
	},
): Promise<string | undefined> {
	return await show_picker_modal(ctx, {
		title: options.title,
		subtitle: options.subtitle,
		items: options.skills.map((skill) => ({
			value: skill.key,
			label: skill.name,
			description: `${skill_status(skill)} • ${skill.source} • ${skill.key}`,
		})),
		empty_message: options.empty_message,
	});
}

export async function show_skill_detail_modal(
	ctx: ExtensionCommandContext,
	skill: ManagedSkill,
): Promise<void> {
	await show_text_modal(ctx, {
		title: skill.name,
		subtitle: `${skill_status(skill)} • ${skill.source}`,
		text: format_skill_detail(skill),
	});
}

export async function show_skill_list_modal(
	ctx: ExtensionCommandContext,
	mgr: SkillsManager,
): Promise<void> {
	while (true) {
		const skills = sort_skills([
			...mgr.discover(),
			...mgr.discover_importable(),
		]);
		const key = await pick_skill(ctx, {
			title: 'Browse skills',
			subtitle: `${mgr.discover().length} managed • ${mgr.discover_importable().length} importable`,
			skills,
			empty_message: 'No skills found',
		});
		if (!key) return;
		await show_skill_detail_modal(ctx, find_skill(skills, key));
	}
}

export async function show_refresh_summary(
	ctx: ExtensionCommandContext,
	mgr: SkillsManager,
): Promise<void> {
	mgr.refresh();
	await show_text_modal(ctx, {
		title: 'Skills refreshed',
		text: `${mgr.discover().length} managed skills\n${mgr.discover_importable().length} importable skills found`,
	});
}

export async function show_defaults_modal(
	ctx: ExtensionCommandContext,
	mgr: SkillsManager,
): Promise<void> {
	const selected = await show_picker_modal(ctx, {
		title: 'Skill profile baseline',
		subtitle: `Active profile: ${mgr.get_active_profile()}`,
		items: [
			{
				value: 'all-enabled',
				label: 'All enabled',
				description: 'This profile enables every matching skill',
			},
			{
				value: 'all-disabled',
				label: 'All disabled',
				description: 'This profile only enables explicit includes',
			},
		],
	});
	if (!selected) return;
	mgr.set_defaults(selected as 'all-enabled' | 'all-disabled');
	await show_text_modal(ctx, {
		title: 'Skill profile baseline updated',
		text: `Active profile baseline: ${selected}`,
	});
}

export async function pick_profile(
	ctx: ExtensionCommandContext,
	mgr: SkillsManager,
	title: string,
): Promise<string | undefined> {
	return await show_picker_modal(ctx, {
		title,
		subtitle: `Active: ${mgr.get_active_profile()}`,
		items: mgr.list_profiles().map((profile) => ({
			value: profile.name,
			label: `${profile.active ? '● ' : '○ '}${profile.name}`,
			description: profile_description(profile),
		})),
		empty_message: 'No skill profiles found',
	});
}

export async function show_profiles_modal(
	ctx: ExtensionCommandContext,
	mgr: SkillsManager,
): Promise<boolean> {
	while (true) {
		const selected = await show_picker_modal(ctx, {
			title: 'Skill profiles',
			subtitle: `Active: ${mgr.get_active_profile()}`,
			items: [
				{
					value: 'use',
					label: 'Use profile',
					description: 'Switch the active skill profile and reload',
				},
				{
					value: 'create',
					label: 'Create profile',
					description: 'Create a named skill profile',
				},
				{
					value: 'include',
					label: 'Enable skill/pattern',
					description: 'Enable matching skills in a profile',
				},
				{
					value: 'exclude',
					label: 'Disable skill/pattern',
					description: 'Disable matching skills in a profile',
				},
				{
					value: 'show',
					label: 'Show profile details',
					description: 'Inspect include/exclude patterns',
				},
			],
			footer:
				'patterns match skill names, keys, sources, or paths; * is supported',
		});
		if (!selected) return false;

		if (selected === 'use') {
			const profile = await pick_profile(
				ctx,
				mgr,
				'Use skill profile',
			);
			if (!profile) continue;
			try {
				mgr.use_profile(profile);
				ctx.ui.notify(
					`Using skill profile ${profile}. Reloading...`,
					'info',
				);
				await ctx.reload();
				return true;
			} catch (error) {
				ctx.ui.notify(
					error instanceof Error ? error.message : String(error),
					'warning',
				);
			}
		} else if (selected === 'create') {
			const name = await show_input_modal(ctx, {
				title: 'Create skill profile',
				label: 'Profile name',
				trim: true,
			});
			if (!name) continue;
			try {
				mgr.create_profile(name);
				await show_text_modal(ctx, {
					title: 'Skill profile created',
					text: `Created empty profile ${name}. Use /skills profile use ${name} to activate it, then /skills enable <skill> to add skills.`,
				});
			} catch (error) {
				ctx.ui.notify(
					error instanceof Error ? error.message : String(error),
					'warning',
				);
			}
		} else if (selected === 'include' || selected === 'exclude') {
			const profile = await pick_profile(
				ctx,
				mgr,
				selected === 'include'
					? 'Choose enable profile'
					: 'Choose disable profile',
			);
			if (!profile) continue;
			const pattern = await show_input_modal(ctx, {
				title:
					selected === 'include'
						? 'Enable skill or pattern'
						: 'Disable skill or pattern',
				subtitle: `Profile: ${profile}`,
				label: 'Skill name, key, or pattern',
				trim: true,
			});
			if (!pattern) continue;
			try {
				if (selected === 'include')
					mgr.include_in_profile(profile, pattern);
				else mgr.exclude_from_profile(profile, pattern);
				ctx.ui.notify(`Updated ${profile}. Reloading...`, 'info');
				await ctx.reload();
				return true;
			} catch (error) {
				ctx.ui.notify(
					error instanceof Error ? error.message : String(error),
					'warning',
				);
			}
		} else if (selected === 'show') {
			const profile_name = await pick_profile(
				ctx,
				mgr,
				'Show skill profile',
			);
			const profile = mgr
				.list_profiles()
				.find((p) => p.name === profile_name);
			if (!profile) continue;
			await show_text_modal(ctx, {
				title: profile.name,
				subtitle: profile_description(profile),
				text: format_profile_detail(profile),
			});
		}
	}
}
