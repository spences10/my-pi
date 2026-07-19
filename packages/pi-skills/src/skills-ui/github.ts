import type { ExtensionCommandContext } from '@earendil-works/pi-coding-agent';
import {
	run_with_progress_modal,
	show_confirm_modal,
	show_input_modal,
	show_picker_modal,
	show_text_modal,
} from '@spences10/pi-tui-modal';
import {
	has_gh_skill,
	list_github_repository_skills_async,
	run_gh_skill_install_async,
	run_gh_skill_preview_async,
	run_gh_skill_search_async,
	run_gh_skill_update_async,
	type GhSkillSearchResult,
} from '../gh-skill.js';

function is_already_installed_error(error: unknown): boolean {
	const message =
		error instanceof Error ? error.message : String(error);
	return message.includes('already installed');
}

function format_search_result(result: GhSkillSearchResult): string {
	const namespace = result.namespace ? `${result.namespace}/` : '';
	return `${namespace}${result.skillName} — ${result.repo}`;
}

async function confirm_untrusted_install(
	ctx: ExtensionCommandContext,
	result: GhSkillSearchResult,
): Promise<boolean> {
	return await show_confirm_modal(ctx, {
		title: 'Install unreviewed GitHub skill?',
		message: `Skills can instruct the model to run tools and may include executable scripts. Install only after reviewing the source.\n\n${format_search_result(result)}\n${result.path}`,
		confirm_label: 'Install anyway',
		cancel_label: 'Cancel',
	});
}

export async function show_search_github_skills_modal(
	ctx: ExtensionCommandContext,
): Promise<boolean> {
	if (!has_gh_skill()) {
		ctx.ui.notify(
			'Search GitHub skills requires gh v2.90.0+ with `gh skill` support.',
			'warning',
		);
		return false;
	}
	const query = await show_input_modal(ctx, {
		title: 'Search GitHub skills',
		subtitle: 'Uses gh skill search. Review before installing.',
		label: 'Search query',
		trim: true,
	});
	if (!query) return false;

	try {
		const results = await run_with_progress_modal(
			ctx,
			{
				title: 'Searching GitHub skills',
				message: `Running gh skill search ${query}`,
			},
			async ({ signal }) =>
				await run_gh_skill_search_async(query, 15, undefined, {
					signal,
				}),
		);
		if (!results) return false;
		if (results.length === 0) {
			await show_text_modal(ctx, {
				title: 'No GitHub skills found',
				text: `Nothing found matching “${query}”.\n\nTry a shorter query, a skill name like “sveltekit”, or search directly with:\n\ngh skill search ${query}`,
				footer:
					'Source: gh skill search over public GitHub SKILL.md files',
			});
			return false;
		}

		const result_items = results.map((result) => ({
			value: `${result.repo}\t${result.path}`,
			label: format_search_result(result),
			description: `${result.stars}★ • ${result.description}`,
		}));
		const selected_path = await show_picker_modal(ctx, {
			title: 'GitHub skill search results',
			subtitle: `${results.length} results for ${query}`,
			items: result_items,
			selected_footer: (item) => {
				const [repo, path] = item?.value.split('\t') ?? [];
				return repo && path
					? [
							`Selected source: ${repo}`,
							`Selected path: ${path}`,
							'Preview before installing untrusted skills.',
						]
					: 'Source: gh skill search over public GitHub SKILL.md files';
			},
		});
		if (!selected_path) return false;
		const [repo, path] = selected_path.split('\t');
		const selected = results.find(
			(result) => result.repo === repo && result.path === path,
		);
		if (!repo || !path || !selected) return false;

		const preview = await run_with_progress_modal(
			ctx,
			{
				title: 'Previewing GitHub skill',
				message: `Running gh skill preview ${repo} ${path}`,
			},
			async ({ signal }) =>
				await run_gh_skill_preview_async(repo, path, undefined, {
					signal,
				}),
		);
		if (preview === undefined) return false;
		await show_text_modal(ctx, {
			title: format_search_result(selected),
			subtitle: `${repo} • ${path}`,
			text: preview || 'No preview output.',
			footer:
				'Review complete • installation still requires confirmation',
		});
		if (!(await confirm_untrusted_install(ctx, selected)))
			return false;
		const output = await run_with_progress_modal(
			ctx,
			{
				title: 'Installing GitHub skill',
				message: `Installing ${path} from ${repo}`,
			},
			async ({ signal }) =>
				await run_gh_skill_install_async(
					{ repository: repo, skill: path, flags: [] },
					undefined,
					{ signal },
				),
		);
		if (output === undefined) return false;
		await show_text_modal(ctx, {
			title: 'GitHub skill installed',
			text: `${output || `Installed ${path} from ${repo}`}

Reloading...`,
		});
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

export async function show_add_github_skill_modal(
	ctx: ExtensionCommandContext,
): Promise<boolean> {
	if (!has_gh_skill()) {
		ctx.ui.notify(
			'Add GitHub skill requires gh v2.90.0+ with `gh skill` support.',
			'warning',
		);
		return false;
	}
	const repository = await show_input_modal(ctx, {
		title: 'Add GitHub skill',
		subtitle: 'Example: spences10/skills',
		label: 'Repository (owner/repo)',
		trim: true,
	});
	if (!repository) return false;

	const action = await show_picker_modal(ctx, {
		title: 'Add GitHub skill',
		subtitle: repository,
		items: [
			{
				value: 'one',
				label: 'Choose one skill',
				description: 'Enter a skill name or exact path to install',
			},
			{
				value: 'all',
				label: 'Install all skills from repo',
				description:
					'List and preview every SKILL.md, confirm, install, then reload',
			},
		],
	});
	if (!action) return false;

	if (action === 'one') {
		const skill = await show_input_modal(ctx, {
			title: 'Add one GitHub skill',
			subtitle: `${repository} • example: svelte-runes or svelte-runes@v1.0.0`,
			label: 'Skill name, optionally @tag-or-sha',
			trim: true,
		});
		if (!skill) return false;
		try {
			const preview = await run_with_progress_modal(
				ctx,
				{
					title: 'Previewing GitHub skill',
					message: `Running gh skill preview ${repository} ${skill}`,
				},
				async ({ signal }) =>
					await run_gh_skill_preview_async(
						repository,
						skill,
						undefined,
						{ signal },
					),
			);
			if (preview === undefined) return false;
			await show_text_modal(ctx, {
				title: `Preview ${skill}`,
				subtitle: repository,
				text: preview || 'No preview output.',
			});
			const confirmed = await show_confirm_modal(ctx, {
				title: `Install ${skill}?`,
				message: `Install ${skill} from ${repository} after reviewing the preview?`,
				confirm_label: 'Install',
				cancel_label: 'Cancel',
			});
			if (!confirmed) return false;
			const output = await run_with_progress_modal(
				ctx,
				{
					title: 'Installing GitHub skill',
					message: `Installing ${skill} from ${repository}`,
				},
				async ({ signal, update }) => {
					update({ current: skill });
					return await run_gh_skill_install_async(
						{
							repository,
							skill,
							flags: [],
						},
						undefined,
						{ signal },
					);
				},
			);
			if (output === undefined) return false;
			await show_text_modal(ctx, {
				title: 'GitHub skill added',
				text: `${output || `Installed ${skill} from ${repository}`}\n\nReloading...`,
			});
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

	const ref_mode = await show_picker_modal(ctx, {
		title: 'Install all GitHub skills',
		subtitle: repository,
		items: [
			{
				value: 'default',
				label: 'Use default branch',
				description: 'Install current default branch without a pin',
			},
			{
				value: 'pin',
				label: 'Pin to tag, branch, or commit SHA',
				description: 'Recommended for reviewed/reproducible installs',
			},
		],
	});
	if (!ref_mode) return false;
	const pin =
		ref_mode === 'pin'
			? await show_input_modal(ctx, {
					title: 'Install all GitHub skills',
					subtitle: repository,
					label: 'Pin tag, branch, or commit SHA',
					trim: true,
				})
			: undefined;
	if (ref_mode === 'pin' && !pin) return false;
	const existing_mode = await show_picker_modal(ctx, {
		title: 'Install all GitHub skills',
		subtitle: 'When a skill is already installed',
		items: [
			{
				value: 'skip',
				label: 'Skip existing skills',
				description: 'Leave installed skills unchanged',
			},
			{
				value: 'overwrite',
				label: 'Overwrite existing skills',
				description: 'Pass --force to gh skill install',
			},
		],
	});
	if (!existing_mode) return false;
	try {
		const previews = await run_with_progress_modal(
			ctx,
			{
				title: 'Previewing repository skills',
				message: `Reading skills from ${repository}`,
			},
			async ({ signal, update }) => {
				const skills = await list_github_repository_skills_async(
					repository,
					pin,
					undefined,
					{ signal },
				);
				const sections: string[] = [];
				for (const [index, skill] of skills.entries()) {
					update({
						current: skill.name,
						completed: index,
						total: skills.length,
					});
					const preview = await run_gh_skill_preview_async(
						repository,
						pin ? `${skill.path}@${pin}` : skill.path,
						undefined,
						{ signal },
					);
					sections.push(
						`## ${skill.name} (${skill.path})\n\n${preview || 'No preview output.'}`,
					);
				}
				return { skills, text: sections.join('\n\n---\n\n') };
			},
		);
		if (previews === undefined) return false;
		if (previews.skills.length === 0) {
			ctx.ui.notify(
				`No SKILL.md files found in ${repository}`,
				'warning',
			);
			return false;
		}
		await show_text_modal(ctx, {
			title: `Review ${previews.skills.length} repository skills`,
			subtitle: repository,
			text: previews.text,
		});
		const confirmed = await show_confirm_modal(ctx, {
			title: `Install ${previews.skills.length} skills?`,
			message: `Install the reviewed skills from ${repository}? Existing-skill policy: ${existing_mode}.`,
			confirm_label: 'Install all',
			cancel_label: 'Cancel',
		});
		if (!confirmed) return false;
		const result = await run_with_progress_modal(
			ctx,
			{
				title: 'Installing GitHub skills',
				message: `Reading skills from ${repository}`,
			},
			async ({ signal, update }) => {
				const skills = await list_github_repository_skills_async(
					repository,
					pin,
					undefined,
					{ signal },
				);
				if (skills.length === 0) {
					return { lines: [], installed: 0, skipped: 0, failed: 0 };
				}
				const lines: string[] = [];
				let installed = 0;
				let skipped = 0;
				let failed = 0;
				update({
					message:
						existing_mode === 'overwrite'
							? 'Overwriting existing skills...'
							: 'Installing missing skills...',
					completed: 0,
					total: skills.length,
				});
				for (const [index, skill] of skills.entries()) {
					const flags = [
						...(pin ? ['--pin', pin] : []),
						...(existing_mode === 'overwrite' ? ['--force'] : []),
					];
					update({
						current: skill.name,
						completed: index,
						total: skills.length,
					});
					try {
						const output = await run_gh_skill_install_async(
							{
								repository,
								skill: skill.path,
								flags,
							},
							undefined,
							{ signal },
						);
						installed += 1;
						lines.push(`✓ ${skill.name}`);
						update({
							completed: index + 1,
							line: `✓ ${skill.name}`,
						});
						if (output) lines.push(output.split('\n')[0] ?? output);
					} catch (error) {
						if (signal.aborted) throw error;
						if (
							existing_mode === 'skip' &&
							is_already_installed_error(error)
						) {
							skipped += 1;
							lines.push(`⊘ ${skill.name} already installed`);
							update({
								completed: index + 1,
								line: `⊘ ${skill.name} already installed`,
							});
							continue;
						}
						failed += 1;
						const message =
							error instanceof Error ? error.message : String(error);
						lines.push(`! ${skill.name}: ${message}`);
						update({
							completed: index + 1,
							line: `! ${skill.name}: ${message}`,
						});
					}
				}
				return { lines, installed, skipped, failed };
			},
		);
		if (result === undefined) return false;
		const { lines, installed, skipped, failed } = result;
		if (lines.length === 0 && installed === 0) {
			ctx.ui.notify(
				`No SKILL.md files found in ${repository}`,
				'warning',
			);
			return false;
		}
		await show_text_modal(ctx, {
			title: 'GitHub skills added',
			text: `Installed ${installed}, skipped ${skipped}, failed ${failed} from ${repository}.\n\n${lines.join('\n')}${installed > 0 ? '\n\nReloading...' : ''}`,
		});
		if (installed > 0) {
			await ctx.reload();
			return true;
		}
		return false;
	} catch (error) {
		ctx.ui.notify(
			error instanceof Error ? error.message : String(error),
			'warning',
		);
		return false;
	}
}

export async function show_update_github_skills_modal(
	ctx: ExtensionCommandContext,
): Promise<boolean> {
	if (!has_gh_skill()) {
		ctx.ui.notify(
			'Update GitHub skills requires gh v2.90.0+ with `gh skill` support.',
			'warning',
		);
		return false;
	}
	try {
		const check_output = await run_with_progress_modal(
			ctx,
			{
				title: 'Checking GitHub skill updates',
				message: 'Running gh skill update --dry-run',
			},
			async ({ signal }) =>
				await run_gh_skill_update_async(['--dry-run'], undefined, {
					signal,
				}),
		);
		if (check_output === undefined) return false;
		const selected = await show_picker_modal(ctx, {
			title: 'Update GitHub skills',
			subtitle: 'Dry-run result',
			items: [
				{
					value: 'apply',
					label: 'Apply updates',
					description: 'Run gh skill update --all and reload',
				},
				{
					value: 'check-only',
					label: 'Check only',
					description: 'Show dry-run output without modifying files',
				},
			],
			footer:
				check_output || 'No output from gh skill update --dry-run.',
		});
		if (!selected) return false;
		if (selected === 'check-only') {
			await show_text_modal(ctx, {
				title: 'GitHub skill update check',
				text:
					check_output || 'No output from gh skill update --dry-run.',
			});
			return false;
		}
		const output = await run_with_progress_modal(
			ctx,
			{
				title: 'Updating GitHub skills',
				message: 'Running gh skill update --all',
			},
			async ({ signal }) =>
				await run_gh_skill_update_async(['--all'], undefined, {
					signal,
				}),
		);
		if (output === undefined) return false;
		await show_text_modal(ctx, {
			title: 'GitHub skills updated',
			text: `${output || 'gh skill update --all completed.'}\n\nReloading...`,
		});
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
