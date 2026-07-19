import type { ExtensionCommandContext } from '@earendil-works/pi-coding-agent';
import {
	show_input_modal,
	show_picker_modal,
	show_text_modal,
} from '@spences10/pi-tui-modal';
import type { SkillsManager } from '../manager.js';
import {
	format_profile_detail,
	profile_description,
} from '../skill-utils.js';

export async function show_refresh_summary(
	ctx: ExtensionCommandContext,
	mgr: SkillsManager,
): Promise<void> {
	mgr.refresh();
	ctx.ui.notify(
		`Skills refreshed: ${mgr.discover().length} managed`,
		'info',
	);
}

export async function show_defaults_modal(
	ctx: ExtensionCommandContext,
	mgr: SkillsManager,
): Promise<boolean> {
	const selected = await show_picker_modal(ctx, {
		title: 'Default skill policy',
		subtitle: `Active profile: ${mgr.get_active_profile()}`,
		items: [
			{
				value: 'all-enabled',
				label: 'Enable by default',
				description:
					'Start with matching skills enabled; exclude rules turn skills off',
			},
			{
				value: 'all-disabled',
				label: 'Disable by default',
				description:
					'Start with skills disabled; include rules turn skills on',
			},
		],
	});
	if (!selected) return false;
	mgr.set_defaults(selected as 'all-enabled' | 'all-disabled');
	await show_text_modal(ctx, {
		title: 'Default skill policy updated',
		text: `Active profile now starts from: ${selected}\n\nReloading...`,
	});
	await ctx.reload();
	return true;
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
					label: 'Add include rule',
					description: 'Turn on skills that match a profile pattern',
				},
				{
					value: 'exclude',
					label: 'Add exclude rule',
					description: 'Turn off skills that match a profile pattern',
				},
				{
					value: 'defaults',
					label: 'Default skill policy',
					description:
						'Choose the profile starting point before rules apply',
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
					? 'Choose profile for include rule'
					: 'Choose profile for exclude rule',
			);
			if (!profile) continue;
			const pattern = await show_input_modal(ctx, {
				title:
					selected === 'include'
						? 'Add include rule'
						: 'Add exclude rule',
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
		} else if (selected === 'defaults') {
			if (await show_defaults_modal(ctx, mgr)) return true;
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
