import type {
	ExtensionAPI,
	ExtensionCommandContext,
} from '@earendil-works/pi-coding-agent';
import type { SettingItem } from '@earendil-works/pi-tui';
import {
	show_confirm_modal,
	show_picker_modal,
	show_settings_modal,
	show_text_modal,
} from '@spences10/pi-tui-modal';
import {
	delete_managed_skill as delete_imported_skill,
	find_rebind_candidate,
	get_imported_skill_sync_status,
	import_external_skill,
	sync_imported_skill,
} from './importer.js';
import {
	scan_importable_skills,
	scan_managed_skills,
	type DiscoveredSkill,
} from './scanner.js';

const WARNING =
	'External skills can instruct agent behavior and tool use. Import copies only after reviewing their source.';
const selected_label = '● selected';
const skipped_label = '○ skip';
const delete_label = '✕ delete';
const sync_label = '↻ sync';
const keep_label = '○ keep';

function skill_key(skill: DiscoveredSkill): string {
	return `${skill.source}/${skill.name}`;
}

function imported_skills(): DiscoveredSkill[] {
	return scan_managed_skills().filter((skill) => skill.import_meta);
}

function sort_skills(skills: DiscoveredSkill[]): DiscoveredSkill[] {
	return [...skills].sort((a, b) =>
		`${a.name}\0${a.source}`.localeCompare(`${b.name}\0${b.source}`),
	);
}

function find_skill(
	skills: DiscoveredSkill[],
	target: string,
): DiscoveredSkill {
	const trimmed = target.trim();
	const match = skills.find(
		(skill) =>
			skill.name === trimmed ||
			skill_key(skill) === trimmed ||
			skill.baseDir === trimmed ||
			skill.skillPath === trimmed,
	);
	if (!match) throw new Error(`Skill not found: ${target}`);
	return match;
}

function find_imported_for_sync(target: string): DiscoveredSkill {
	const imported = imported_skills();
	try {
		return find_skill(imported, target);
	} catch {
		const external = find_skill(scan_importable_skills(), target);
		const match = imported.find(
			(skill) =>
				skill.import_meta?.source === external.source &&
				skill.import_meta.upstream_base_dir === external.baseDir,
		);
		if (match) return match;
		throw new Error(`Imported copy not found for ${target}`);
	}
}

function format_plugin(skill: DiscoveredSkill): string {
	if (!skill.plugin) return skill.source;
	return [
		skill.source,
		`version ${skill.plugin.version}`,
		skill.plugin.gitCommitSha
			? `commit ${skill.plugin.gitCommitSha.slice(0, 12)}`
			: undefined,
	]
		.filter(Boolean)
		.join(' • ');
}

function format_external(skill: DiscoveredSkill): string {
	return [
		`${skill.name} — ${skill.description}`,
		`key: ${skill_key(skill)}`,
		`source: ${format_plugin(skill)}`,
		`upstream: ${skill.baseDir}`,
	].join('\n');
}

function format_imported(skill: DiscoveredSkill): string {
	const status = get_imported_skill_sync_status(skill);
	const meta = skill.import_meta!;
	return [
		`${skill.name} — ${status.status.replaceAll('-', ' ')}`,
		`key: ${skill_key(skill)}`,
		`source: ${meta.source}`,
		meta.upstream_version
			? `version: ${meta.upstream_version}`
			: undefined,
		meta.upstream_git_commit_sha
			? `commit: ${meta.upstream_git_commit_sha.slice(0, 12)}`
			: undefined,
		`upstream: ${meta.upstream_base_dir}`,
		status.detail,
		status.recovery,
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

async function show_home(
	ctx: ExtensionCommandContext,
): Promise<void> {
	while (true) {
		const external = scan_importable_skills();
		const imported = imported_skills();
		const action = await show_picker_modal(ctx, {
			title: 'Skill importer',
			subtitle: `${external.length} external • ${imported.length} imported copies`,
			footer: WARNING,
			items: [
				{
					value: 'list',
					label: 'List skills',
					description: 'Show importable and imported skills',
				},
				{
					value: 'import',
					label: 'Import external skill',
					description:
						'Copy an external skill into Pi-native storage',
				},
				{
					value: 'sync',
					label: 'Sync imported copy',
					description: 'Refresh a copied skill when upstream changed',
				},
				{
					value: 'delete',
					label: 'Delete imported copy',
					description:
						'Remove only copied skills with importer metadata',
				},
			],
		});
		if (!action) return;
		if (action === 'list') await show_list(ctx);
		else if (action === 'import') await import_command('', ctx);
		else if (action === 'sync') await sync_command('', ctx);
		else if (action === 'delete') await delete_command('', ctx);
	}
}

async function show_list(
	ctx: ExtensionCommandContext,
): Promise<void> {
	const external = sort_skills(scan_importable_skills());
	const imported = sort_skills(imported_skills());
	if (!ctx.hasUI) {
		const text = [
			WARNING,
			'',
			'Importable external skills',
			external.length
				? external.map(format_external).join('\n\n')
				: 'None found.',
			'',
			'Imported copies',
			imported.length
				? imported.map(format_imported).join('\n\n')
				: 'None found.',
		].join('\n');
		ctx.ui.notify(text);
		return;
	}

	const list_items = [
		...external.map((skill) => ({
			kind: 'external' as const,
			value: `external:${skill_key(skill)}`,
			skill,
		})),
		...imported.map((skill) => ({
			kind: 'imported' as const,
			value: `imported:${skill_key(skill)}`,
			skill,
		})),
	];
	const by_value = new Map(
		list_items.map((item) => [item.value, item]),
	);
	while (true) {
		const selected = await show_picker_modal(ctx, {
			title: 'Browse importable skills',
			subtitle: `${external.length} external • ${imported.length} imported`,
			items: list_items.map(({ kind, value, skill }) => ({
				value,
				label: skill.name,
				description:
					kind === 'external'
						? `external • ${skill.source}`
						: `imported • ${get_imported_skill_sync_status(skill).status}`,
			})),
			selected_footer: (item) => {
				const match = item ? by_value.get(item.value) : undefined;
				if (!match) return undefined;
				return (
					match.kind === 'external'
						? format_external(match.skill)
						: format_imported(match.skill)
				).split('\n');
			},
			empty_message: 'No external or imported skills found',
			max_visible: 12,
		});
		if (!selected) return;
		const match = by_value.get(selected);
		if (!match) continue;
		await show_text_modal(ctx, {
			title: match.skill.name,
			text:
				match.kind === 'external'
					? format_external(match.skill)
					: format_imported(match.skill),
		});
	}
}

function selectable_skill_items(
	skills: DiscoveredSkill[],
	selected_value: string,
	unselected_value: string,
): SettingItem[] {
	return skills.map((skill) => {
		return {
			id: skill_key(skill),
			label: skill.name,
			description:
				skill.kind === 'external'
					? format_external(skill)
					: format_imported(skill),
			currentValue: unselected_value,
			values: [unselected_value, selected_value],
		};
	});
}

async function pick_external_many(
	ctx: ExtensionCommandContext,
): Promise<DiscoveredSkill[]> {
	const skills = sort_skills(scan_importable_skills());
	if (skills.length === 0) {
		ctx.ui.notify('No importable external skills found');
		return [];
	}
	const items = selectable_skill_items(
		skills,
		selected_label,
		skipped_label,
	);
	await show_settings_modal(ctx, {
		title: 'Import external skills',
		subtitle: `${skills.length} importable • toggle any skills to import`,
		footer: 'enter toggles',
		items,
		max_visible: 12,
		enable_search: true,
		metadata: (item) => item?.description?.split('\n'),
		on_change: () => undefined,
	});
	const selected = new Set(
		items
			.filter((item) => item.currentValue === selected_label)
			.map((item) => item.id),
	);
	return skills.filter((skill) => selected.has(skill_key(skill)));
}

async function import_command(
	target: string,
	ctx: ExtensionCommandContext,
): Promise<void> {
	try {
		const skills = target
			? [find_skill(scan_importable_skills(), target)]
			: ctx.hasUI
				? await pick_external_many(ctx)
				: [];
		if (skills.length === 0) {
			ctx.ui.notify(
				'Usage: /skill-importer import <key|name>',
				'warning',
			);
			return;
		}
		if (ctx.hasUI) {
			const ok = await show_confirm_modal(ctx, {
				title: `Import ${skills.length} skill${skills.length === 1 ? '' : 's'}?`,
				message: `${WARNING}\n\n${skills.map(format_external).join('\n\n')}`,
				confirm_label: 'Import selected',
				cancel_label: 'Cancel',
			});
			if (!ok) return;
		}
		for (const skill of skills) import_external_skill(skill);
		ctx.ui.notify(
			`Imported ${skills.length} skill${skills.length === 1 ? '' : 's'}. Reloading...`,
			'info',
		);
		await ctx.reload();
	} catch (error) {
		notify_error(ctx, error);
	}
}

async function pick_imported_for_sync(
	ctx: ExtensionCommandContext,
): Promise<DiscoveredSkill[]> {
	const skills = sort_skills(imported_skills());
	if (skills.length === 0) {
		ctx.ui.notify('No imported skill copies found');
		return [];
	}
	const items = selectable_skill_items(
		skills,
		sync_label,
		keep_label,
	);
	await show_settings_modal(ctx, {
		title: 'Sync imported skill copies',
		subtitle: `${skills.length} imported • toggle copies to sync`,
		footer: 'enter toggles',
		items,
		max_visible: 12,
		enable_search: true,
		metadata: (item) => item?.description?.split('\n'),
		on_change: () => undefined,
	});
	const selected = new Set(
		items
			.filter((item) => item.currentValue === sync_label)
			.map((item) => item.id),
	);
	return skills.filter((skill) => selected.has(skill_key(skill)));
}

async function confirm_rebinds(
	ctx: ExtensionCommandContext,
	skills: DiscoveredSkill[],
): Promise<boolean> {
	const rebinds = skills
		.map((skill) => ({
			skill,
			status: get_imported_skill_sync_status(skill),
			candidate: find_rebind_candidate(skill),
		}))
		.filter(
			({ status, candidate }) =>
				status.status === 'missing-upstream' && candidate,
		);
	if (rebinds.length === 0 || !ctx.hasUI) return true;
	const shown = rebinds.slice(0, 8).map(({ skill }) => skill.name);
	const extra = rebinds.length - shown.length;
	return show_confirm_modal(ctx, {
		title: `Rebind ${rebinds.length} skill${rebinds.length === 1 ? '' : 's'}?`,
		message: [
			'The recorded upstream cache paths are gone, but current plugin installs were found.',
			'Rebind metadata to the current plugin cache and sync selected copies?',
			'',
			...shown.map((name) => `• ${name}`),
			extra > 0 ? `• …and ${extra} more` : undefined,
		]
			.filter(Boolean)
			.join('\n'),
		confirm_label: 'Rebind and sync',
		cancel_label: 'Cancel',
	});
}

async function sync_command(
	target: string,
	ctx: ExtensionCommandContext,
): Promise<void> {
	try {
		const skills = target
			? [find_imported_for_sync(target)]
			: ctx.hasUI
				? await pick_imported_for_sync(ctx)
				: [];
		if (skills.length === 0) {
			ctx.ui.notify(
				'Usage: /skill-importer sync <key|name>',
				'warning',
			);
			return;
		}
		if (!(await confirm_rebinds(ctx, skills))) return;
		let changed = 0;
		const failures: string[] = [];
		for (const skill of skills) {
			try {
				if (sync_imported_skill(skill).changed) changed++;
			} catch (error) {
				failures.push(
					error instanceof Error ? error.message : String(error),
				);
			}
		}
		if (failures.length) {
			ctx.ui.notify(failures.join('\n'), 'warning');
		}
		ctx.ui.notify(
			changed
				? `Synced ${changed} skill${changed === 1 ? '' : 's'}. Reloading...`
				: 'Selected skills are already up to date.',
			'info',
		);
		if (changed) await ctx.reload();
	} catch (error) {
		notify_error(ctx, error);
	}
}

async function pick_imported_for_delete(
	ctx: ExtensionCommandContext,
): Promise<DiscoveredSkill[]> {
	const skills = sort_skills(imported_skills());
	if (skills.length === 0) {
		ctx.ui.notify('No imported skill copies found');
		return [];
	}
	const items = selectable_skill_items(
		skills,
		delete_label,
		keep_label,
	);
	await show_settings_modal(ctx, {
		title: 'Delete imported skill copies',
		subtitle: `${skills.length} imported • toggle copies to delete`,
		footer: 'enter toggles',
		items,
		max_visible: 12,
		enable_search: true,
		metadata: (item) => item?.description?.split('\n'),
		on_change: () => undefined,
	});
	const selected = new Set(
		items
			.filter((item) => item.currentValue === delete_label)
			.map((item) => item.id),
	);
	return skills.filter((skill) => selected.has(skill_key(skill)));
}

async function delete_command(
	target: string,
	ctx: ExtensionCommandContext,
): Promise<void> {
	try {
		const skills = target
			? [find_skill(imported_skills(), target)]
			: ctx.hasUI
				? await pick_imported_for_delete(ctx)
				: [];
		if (skills.length === 0) {
			ctx.ui.notify(
				'Usage: /skill-importer delete <key|name>',
				'warning',
			);
			return;
		}
		if (ctx.hasUI) {
			const ok = await show_confirm_modal(ctx, {
				title: `Delete ${skills.length} imported cop${skills.length === 1 ? 'y' : 'ies'}?`,
				message: `Delete ${skills.map((skill) => skill.name).join(', ')}? Upstream external sources are never deleted.`,
				confirm_label: 'Delete selected',
				cancel_label: 'Keep copies',
			});
			if (!ok) return;
		}
		for (const skill of skills) delete_imported_skill(skill);
		ctx.ui.notify(
			`Deleted ${skills.length} imported cop${skills.length === 1 ? 'y' : 'ies'}. Reloading...`,
			'info',
		);
		await ctx.reload();
	} catch (error) {
		notify_error(ctx, error);
	}
}

function completions(prefix: string) {
	const parts = prefix.trimStart().split(/\s+/);
	const has_trailing_space = /\s$/.test(prefix);
	if (parts.length <= 1 && !has_trailing_space) {
		return ['list', 'import', 'sync', 'delete']
			.filter((item) => item.startsWith(parts[0] ?? ''))
			.map((item) => ({ value: item, label: item }));
	}
	const sub = parts[0];
	const target_prefix = parts.slice(1).join(' ').toLowerCase();
	const skills =
		sub === 'import' ? scan_importable_skills() : imported_skills();
	return skills
		.flatMap((skill) => [skill_key(skill), skill.name])
		.filter((item) => item.toLowerCase().includes(target_prefix))
		.slice(0, 20)
		.map((item) => ({ value: `${sub} ${item}`, label: item }));
}

export default async function skill_importer(
	pi: ExtensionAPI,
): Promise<void> {
	pi.registerCommand('skill-importer', {
		description:
			'Import external Agent Skills into Pi-native storage',
		getArgumentCompletions: completions,
		handler: async (args, ctx) => {
			const trimmed = args.trim();
			if (!trimmed && ctx.hasUI) {
				await show_home(ctx);
				return;
			}

			const [sub = 'list', ...rest] = trimmed.split(/\s+/);
			const target = rest.join(' ');
			switch (sub) {
				case 'list':
				case 'ls':
					await show_list(ctx);
					break;
				case 'import':
					await import_command(target, ctx);
					break;
				case 'sync':
					await sync_command(target, ctx);
					break;
				case 'delete':
				case 'remove':
					await delete_command(target, ctx);
					break;
				default:
					ctx.ui.notify(
						'Usage: /skill-importer [list|import|sync|delete] [key|name]',
						'warning',
					);
			}
		},
	});
}
