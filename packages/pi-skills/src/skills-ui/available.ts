import type { ExtensionCommandContext } from '@earendil-works/pi-coding-agent';
import {
	run_with_progress_modal,
	show_confirm_modal,
	show_picker_modal,
	show_text_modal,
} from '@spences10/pi-tui-modal';
import {
	derive_known_github_repositories,
	has_gh_skill,
	list_github_repository_skills_async,
	reconcile_github_repository_skills,
	run_gh_skill_install_async,
	run_gh_skill_list_async,
	run_gh_skill_preview_async,
	run_gh_skill_update_async,
	type GhAvailableRepositorySkill,
	type GhInstalledSkill,
} from '../gh-skill.js';

export interface AvailableSkillsModel {
	installed: GhInstalledSkill[];
	available: GhAvailableRepositorySkill[];
	failed_repositories: Array<{ repository: string; error: string }>;
}

export async function load_available_skills(
	signal?: AbortSignal,
): Promise<AvailableSkillsModel> {
	const installed = await run_gh_skill_list_async(undefined, {
		signal,
	});
	const known = derive_known_github_repositories(installed);
	const settled = await Promise.allSettled(
		known.map(async ({ repository }) => ({
			repository,
			skills: await list_github_repository_skills_async(
				repository,
				undefined,
				undefined,
				{ signal },
			),
		})),
	);
	if (signal?.aborted)
		throw new Error('Available skill discovery cancelled');
	const remote = settled.flatMap((result) =>
		result.status === 'fulfilled' ? [result.value] : [],
	);
	const failed_repositories = settled.flatMap((result, index) =>
		result.status === 'rejected'
			? [
					{
						repository: known[index]?.repository ?? 'unknown',
						error:
							result.reason instanceof Error
								? result.reason.message
								: String(result.reason),
					},
				]
			: [],
	);
	return {
		installed,
		available: reconcile_github_repository_skills(installed, remote)
			.available_skills,
		failed_repositories,
	};
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

async function install_available(
	ctx: ExtensionCommandContext,
	skill: GhAvailableRepositorySkill,
): Promise<boolean> {
	try {
		const preview = await run_with_progress_modal(
			ctx,
			{
				title: `Previewing ${skill.name}`,
				message: `${skill.repository} • ${skill.path}`,
			},
			async ({ signal }) =>
				await run_gh_skill_preview_async(
					skill.repository,
					skill.path,
					undefined,
					{ signal },
				),
		);
		if (preview === undefined) return false;
		await show_text_modal(ctx, {
			title: `Preview ${skill.name}`,
			subtitle: `${skill.repository} • ${skill.path}`,
			text: preview || 'No preview output.',
		});
		const confirmed = await show_confirm_modal(ctx, {
			title: `Install ${skill.name}?`,
			message: `Install only after reviewing the preview.\n\nRepository: ${skill.repository}\nPath: ${skill.path}\nScopes already used by this repository: ${skill.repository_scopes.join(', ')}`,
			confirm_label: 'Install',
			cancel_label: 'Cancel',
		});
		if (!confirmed) return false;
		const output = await run_with_progress_modal(
			ctx,
			{
				title: `Installing ${skill.name}`,
				message: `${skill.repository} • ${skill.path}`,
			},
			async ({ signal }) =>
				await run_gh_skill_install_async(
					{
						repository: skill.repository,
						skill: skill.path,
						flags: [],
					},
					undefined,
					{ signal },
				),
		);
		if (output === undefined) return false;
		ctx.ui.notify(
			`${output || `Installed ${skill.name}`}. Reloading...`,
			'info',
		);
		await ctx.reload();
		return true;
	} catch (error) {
		notify_error(ctx, error);
		return false;
	}
}

async function update_installed(
	ctx: ExtensionCommandContext,
): Promise<boolean> {
	try {
		const check = await run_with_progress_modal(
			ctx,
			{
				title: 'Checking GitHub skill updates',
				message: 'gh skill update --dry-run',
			},
			async ({ signal }) =>
				await run_gh_skill_update_async(['--dry-run'], undefined, {
					signal,
				}),
		);
		if (check === undefined) return false;
		await show_text_modal(ctx, {
			title: 'GitHub skill update check',
			text: check || 'No updates reported.',
		});
		const confirmed = await show_confirm_modal(ctx, {
			title: 'Apply GitHub skill updates?',
			message:
				'Apply available updates to all unpinned GitHub skills?',
			confirm_label: 'Update',
			cancel_label: 'Cancel',
		});
		if (!confirmed) return false;
		const output = await run_with_progress_modal(
			ctx,
			{
				title: 'Updating GitHub skills',
				message: 'gh skill update --all',
			},
			async ({ signal }) =>
				await run_gh_skill_update_async(['--all'], undefined, {
					signal,
				}),
		);
		if (output === undefined) return false;
		ctx.ui.notify(
			`${output || 'GitHub skills updated.'} Reloading...`,
			'info',
		);
		await ctx.reload();
		return true;
	} catch (error) {
		notify_error(ctx, error);
		return false;
	}
}

export async function show_available_skills_modal(
	ctx: ExtensionCommandContext,
): Promise<boolean> {
	if (!has_gh_skill()) {
		ctx.ui.notify(
			'Available GitHub skills require gh v2.90.0+ with `gh skill` support.',
			'warning',
		);
		return false;
	}
	let model: AvailableSkillsModel;
	try {
		const loaded = await run_with_progress_modal(
			ctx,
			{
				title: 'Finding available skills',
				message: 'Reading installed skills and known repositories',
			},
			async ({ signal }) => await load_available_skills(signal),
		);
		if (!loaded) return false;
		model = loaded;
	} catch (error) {
		notify_error(ctx, error);
		return false;
	}
	if (model.failed_repositories.length) {
		ctx.ui.notify(
			`Could not inspect ${model.failed_repositories.length} known repositor${model.failed_repositories.length === 1 ? 'y' : 'ies'}: ${model.failed_repositories.map(({ repository }) => repository).join(', ')}`,
			'warning',
		);
	}
	if (model.installed.length === 0) {
		ctx.ui.notify(
			'No GitHub-installed Pi skills found. Use Add / import first.',
			'info',
		);
		return false;
	}
	const selected = await show_picker_modal(ctx, {
		title: 'Available',
		subtitle: `${model.available.length} new • ${model.installed.length} installed GitHub skills`,
		empty_message: 'No new skills found in known repositories',
		items: [
			...model.available.map((skill) => ({
				value: `new:${skill.repository}:${skill.path}`,
				label: `New • ${skill.name}`,
				description: `${skill.repository} • ${skill.path}`,
			})),
			{
				value: 'updates',
				label: 'Check installed skills for updates',
				description:
					'Dry-run first; applying updates requires confirmation',
			},
		],
		footer:
			'Known repositories are derived from gh skill list; nothing installs automatically.',
	});
	if (selected === 'updates') return await update_installed(ctx);
	const skill = model.available.find(
		(candidate) =>
			`new:${candidate.repository}:${candidate.path}` === selected,
	);
	return skill ? await install_available(ctx, skill) : false;
}
