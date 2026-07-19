import type { ExtensionCommandContext } from '@earendil-works/pi-coding-agent';
import { scan_imported_skills } from '@spences10/pi-skill-importer';
import {
	show_confirm_modal,
	show_picker_modal,
	show_settings_modal,
	show_text_modal,
} from '@spences10/pi-tui-modal';
import type { SkillsManager } from '../manager.js';
import {
	DISABLED,
	ENABLED,
	format_skill_detail,
	sets_equal,
	sort_skills,
	to_setting_item,
} from '../skill-utils.js';

export async function show_skills_manager_modal(
	ctx: ExtensionCommandContext,
	mgr: SkillsManager,
): Promise<boolean> {
	const discovered = sort_skills(mgr.discover());
	if (discovered.length === 0) {
		ctx.ui.notify('No managed skills found');
		return false;
	}
	const initial_enabled = new Set(
		discovered
			.filter((skill) => skill.enabled)
			.map((skill) => skill.key),
	);
	const current_enabled = new Set(initial_enabled);
	const items = discovered.map(to_setting_item);
	const metadata_by_id = new Map(
		items.map((item) => [item.id, item.description ?? '']),
	);
	for (const item of items) item.description = '';

	await show_settings_modal(ctx, {
		title: 'Installed skill enablement',
		subtitle: () =>
			`profile ${mgr.get_active_profile()} • ${current_enabled.size} enabled • ${discovered.length - current_enabled.size} disabled`,
		items,
		max_visible: Math.min(Math.max(items.length + 4, 8), 12),
		enable_search: true,
		metadata: (item) =>
			item ? metadata_by_id.get(item.id)?.split('\n') : undefined,
		on_change: (id, new_value) => {
			if (new_value === ENABLED) {
				current_enabled.add(id);
				mgr.enable(id);
			} else if (new_value === DISABLED) {
				current_enabled.delete(id);
				mgr.disable(id);
			}
		},
	});

	if (!sets_equal(initial_enabled, current_enabled)) {
		ctx.ui.notify('Reloading to apply updated skills...', 'info');
		await ctx.reload();
		return true;
	}
	return false;
}

async function browse_installed(
	ctx: ExtensionCommandContext,
	mgr: SkillsManager,
): Promise<boolean> {
	const skills = sort_skills(mgr.discover());
	const selected = await show_picker_modal(ctx, {
		title: 'Installed skill details',
		subtitle: `${skills.length} managed • profile ${mgr.get_active_profile()}`,
		empty_message: 'No managed skills found',
		items: skills.map((skill) => ({
			value: skill.key,
			label: skill.name,
			description: `${skill.enabled ? 'enabled' : 'disabled'} • ${skill.source} • ${skill.key}`,
		})),
	});
	const skill = skills.find(
		(candidate) => candidate.key === selected,
	);
	if (!skill) return false;
	const importer_owned = scan_imported_skills().some(
		(imported) => imported.baseDir === skill.baseDir,
	);
	const action = await show_picker_modal(ctx, {
		title: skill.name,
		subtitle: `${skill.enabled ? 'enabled' : 'disabled'} • ${skill.source}`,
		footer: importer_owned
			? `${skill.baseDir} • manage this importer-owned copy in Add / import`
			: skill.baseDir,
		items: [
			{
				value: 'details',
				label: 'View details',
				description: 'Read-only provenance, path, and profile status',
			},
			...(importer_owned
				? []
				: [
						{
							value: 'delete',
							label: 'Delete from disk',
							description:
								'Separate destructive action with confirmation',
						},
					]),
		],
	});
	if (action === 'details') {
		await show_text_modal(ctx, {
			title: skill.name,
			text: format_skill_detail(skill),
		});
		return false;
	}
	if (action !== 'delete') return false;
	const confirmed = await show_confirm_modal(ctx, {
		title: `Delete ${skill.name}?`,
		message: `Delete ${skill.baseDir} from disk? This cannot be undone.`,
		confirm_label: 'Delete',
		cancel_label: 'Keep skill',
	});
	if (!confirmed) return false;
	try {
		mgr.delete_skill(skill.key);
		ctx.ui.notify(`Deleted ${skill.name}. Reloading...`, 'info');
		await ctx.reload();
		return true;
	} catch (error) {
		ctx.ui.notify(
			error instanceof Error ? error.message : String(error),
			'warning',
		);
		return false;
	}
}

export async function show_installed_skills_modal(
	ctx: ExtensionCommandContext,
	mgr: SkillsManager,
): Promise<boolean> {
	const skills = mgr.discover();
	const action = await show_picker_modal(ctx, {
		title: 'Installed',
		subtitle: `${skills.length} managed • ${skills.filter((skill) => skill.enabled).length} enabled • profile ${mgr.get_active_profile()}`,
		items: [
			{
				value: 'enablement',
				label: 'Enable / disable',
				description:
					'Search installed skills and update the active profile',
			},
			{
				value: 'details',
				label: 'Details / delete',
				description:
					'Inspect provenance or choose a separately confirmed delete',
			},
		],
	});
	if (action === 'enablement')
		return await show_skills_manager_modal(ctx, mgr);
	if (action === 'details') return await browse_installed(ctx, mgr);
	return false;
}
