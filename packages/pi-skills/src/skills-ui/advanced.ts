import type { ExtensionCommandContext } from '@earendil-works/pi-coding-agent';
import { show_picker_modal } from '@spences10/pi-tui-modal';
import type { SkillsManager } from '../manager.js';
import {
	show_defaults_modal,
	show_profiles_modal,
	show_refresh_summary,
} from './profiles.js';
import { show_skill_list_modal } from './skill-list.js';

export async function show_advanced_skills_modal(
	ctx: ExtensionCommandContext,
	mgr: SkillsManager,
): Promise<boolean> {
	const action = await show_picker_modal(ctx, {
		title: 'Advanced skill settings',
		subtitle: `Active profile: ${mgr.get_active_profile()}`,
		items: [
			{
				value: 'profiles',
				label: 'Profiles',
				description: 'Switch profiles and edit include/exclude rules',
			},
			{
				value: 'defaults',
				label: 'Default skill policy',
				description: 'Choose the active profile baseline',
			},
			{
				value: 'refresh',
				label: 'Refresh discovery',
				description: 'Rescan managed and project skill paths',
			},
			{
				value: 'browse',
				label: 'Diagnostic browser',
				description: 'Read-only list and detailed discovery metadata',
			},
		],
	});
	if (action === 'profiles')
		return await show_profiles_modal(ctx, mgr);
	if (action === 'defaults')
		return await show_defaults_modal(ctx, mgr);
	if (action === 'refresh') await show_refresh_summary(ctx, mgr);
	else if (action === 'browse') await show_skill_list_modal(ctx, mgr);
	return false;
}
