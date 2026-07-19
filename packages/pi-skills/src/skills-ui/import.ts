import type { ExtensionCommandContext } from '@earendil-works/pi-coding-agent';
import {
	delete_imported_skill,
	get_imported_skill_sync_status,
	import_external_skill,
	scan_importable_skills,
	scan_imported_skills,
	sync_imported_skill,
	type ImportableSkill,
	type ImportedSkill,
} from '@spences10/pi-skill-importer';
import {
	run_with_progress_modal,
	show_confirm_modal,
	show_picker_modal,
	show_text_modal,
} from '@spences10/pi-tui-modal';
import { show_add_github_skill_modal } from './github.js';

const WARNING =
	'External skills can instruct agent behavior and tool use. Review the source before importing.';

function key(skill: ImportableSkill | ImportedSkill): string {
	return `${skill.source}/${skill.name}`;
}

function sort<T extends ImportableSkill | ImportedSkill>(
	skills: T[],
): T[] {
	return [...skills].sort((a, b) =>
		`${a.name}\0${a.source}`.localeCompare(`${b.name}\0${b.source}`),
	);
}

function imported_detail(skill: ImportedSkill): string {
	const status = get_imported_skill_sync_status(skill);
	return [
		`${skill.name} — ${status.status.replaceAll('-', ' ')}`,
		`source: ${skill.import_meta.source}`,
		`upstream: ${skill.import_meta.upstream_base_dir}`,
		`installed: ${skill.baseDir}`,
		status.detail,
		status.recovery,
	]
		.filter(Boolean)
		.join('\n');
}

function external_detail(skill: ImportableSkill): string {
	return [
		`${skill.name} — ${skill.description}`,
		`source: ${skill.source}`,
		`version: ${skill.plugin.version}`,
		skill.plugin.gitCommitSha
			? `commit: ${skill.plugin.gitCommitSha.slice(0, 12)}`
			: undefined,
		`upstream: ${skill.baseDir}`,
	]
		.filter(Boolean)
		.join('\n');
}

function notify_error(
	ctx: ExtensionCommandContext,
	error: unknown,
): void {
	ctx.ui.notify(
		error instanceof Error ? error.message : String(error),
		'warning',
	);
}

async function import_external(
	ctx: ExtensionCommandContext,
): Promise<boolean> {
	const skills = sort(scan_importable_skills());
	const selected = await show_picker_modal(ctx, {
		title: 'Import external skill',
		subtitle: `${skills.length} compatible plugin skill${skills.length === 1 ? '' : 's'}`,
		footer: WARNING,
		empty_message: 'No compatible external skills found',
		items: skills.map((skill) => ({
			value: key(skill),
			label: skill.name,
			description: `${skill.source} • ${skill.baseDir}`,
		})),
	});
	const skill = skills.find(
		(candidate) => key(candidate) === selected,
	);
	if (!skill) return false;
	await show_text_modal(ctx, {
		title: `Review ${skill.name}`,
		text: external_detail(skill),
		footer: WARNING,
	});
	const confirmed = await show_confirm_modal(ctx, {
		title: `Import ${skill.name}?`,
		message: `Copy this skill into Pi-native storage?\n\n${external_detail(skill)}`,
		confirm_label: 'Import',
		cancel_label: 'Cancel',
	});
	if (!confirmed) return false;
	try {
		const result = await run_with_progress_modal(
			ctx,
			{ title: 'Importing external skill', message: skill.name },
			async () => import_external_skill(skill),
		);
		if (!result) return false;
		ctx.ui.notify(`Imported ${skill.name}. Reloading...`, 'info');
		await ctx.reload();
		return true;
	} catch (error) {
		notify_error(ctx, error);
		return false;
	}
}

async function manage_imported(
	ctx: ExtensionCommandContext,
): Promise<boolean> {
	const skills = sort(scan_imported_skills());
	const selected = await show_picker_modal(ctx, {
		title: 'Imported copies',
		subtitle: `${skills.length} importer-managed cop${skills.length === 1 ? 'y' : 'ies'}`,
		empty_message: 'No imported copies found',
		items: skills.map((skill) => {
			const status = get_imported_skill_sync_status(skill);
			return {
				value: key(skill),
				label: skill.name,
				description: `${status.status.replaceAll('-', ' ')} • ${skill.import_meta.source}`,
			};
		}),
	});
	const skill = skills.find(
		(candidate) => key(candidate) === selected,
	);
	if (!skill) return false;
	const action = await show_picker_modal(ctx, {
		title: skill.name,
		subtitle: get_imported_skill_sync_status(skill).status.replaceAll(
			'-',
			' ',
		),
		footer: imported_detail(skill),
		items: [
			{
				value: 'details',
				label: 'View details',
				description: 'Inspect provenance and sync status',
			},
			{
				value: 'sync',
				label: 'Sync/rebind safely',
				description: 'Refuses to overwrite local changes',
			},
			{
				value: 'delete',
				label: 'Delete imported copy',
				description: 'Leaves the upstream plugin untouched',
			},
		],
	});
	if (action === 'details') {
		await show_text_modal(ctx, {
			title: skill.name,
			text: imported_detail(skill),
		});
		return false;
	}
	if (action === 'sync') {
		const confirmed = await show_confirm_modal(ctx, {
			title: `Sync ${skill.name}?`,
			message: `${imported_detail(skill)}\n\nContinue only if the upstream source is trusted.`,
			confirm_label: 'Sync',
			cancel_label: 'Cancel',
		});
		if (!confirmed) return false;
		try {
			const result = await run_with_progress_modal(
				ctx,
				{ title: 'Syncing imported skill', message: skill.name },
				async () => sync_imported_skill(skill),
			);
			if (!result) return false;
			ctx.ui.notify(
				result.changed
					? `Synced ${skill.name}. Reloading...`
					: `${skill.name} is already up to date.`,
				'info',
			);
			if (result.changed) await ctx.reload();
			return result.changed;
		} catch (error) {
			notify_error(ctx, error);
			return false;
		}
	}
	if (action === 'delete') {
		const confirmed = await show_confirm_modal(ctx, {
			title: `Delete imported copy ${skill.name}?`,
			message: `Delete ${skill.baseDir}? The upstream plugin source is not removed.`,
			confirm_label: 'Delete copy',
			cancel_label: 'Keep copy',
		});
		if (!confirmed) return false;
		try {
			delete_imported_skill(skill);
			ctx.ui.notify(
				`Deleted imported copy ${skill.name}. Reloading...`,
				'info',
			);
			await ctx.reload();
			return true;
		} catch (error) {
			notify_error(ctx, error);
		}
	}
	return false;
}

export async function show_add_import_modal(
	ctx: ExtensionCommandContext,
): Promise<boolean> {
	const external = scan_importable_skills().length;
	const imported = scan_imported_skills().length;
	const action = await show_picker_modal(ctx, {
		title: 'Add / import',
		subtitle: `${external} external • ${imported} imported copies`,
		items: [
			{
				value: 'github',
				label: 'Add from GitHub',
				description:
					'Search or enter a repository, preview, confirm, and install',
			},
			{
				value: 'external',
				label: 'Import external/plugin skill',
				description:
					'Copy a compatible Claude plugin skill into Pi storage',
			},
			{
				value: 'imported',
				label: 'Manage imported copies',
				description:
					'Inspect, sync/rebind, or safely delete imported copies',
			},
		],
		footer: WARNING,
	});
	if (action === 'github')
		return await show_add_github_skill_modal(ctx);
	if (action === 'external') return await import_external(ctx);
	if (action === 'imported') return await manage_imported(ctx);
	return false;
}
