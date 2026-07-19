import type { ExtensionCommandContext } from '@earendil-works/pi-coding-agent';
import { show_picker_modal } from '@spences10/pi-tui-modal';

export interface SkillsHomeCounts {
	managed: number;
	enabled: number;
	external: number;
	imported: number;
}

export async function show_skills_home_modal(
	ctx: ExtensionCommandContext,
	counts: SkillsHomeCounts,
	active_profile: string,
): Promise<string | undefined> {
	return await show_picker_modal(ctx, {
		title: 'Skills',
		subtitle: `${counts.managed} installed • ${counts.enabled} enabled • profile ${active_profile}`,
		items: [
			{
				value: 'installed',
				label: 'Installed',
				description:
					'Enable, disable, inspect, or separately delete installed skills',
			},
			{
				value: 'available',
				label: 'Available',
				description:
					'Find new skills in known repositories and check updates',
			},
			{
				value: 'add-import',
				label: 'Add / import',
				description: `${counts.external} external • ${counts.imported} imported copies`,
			},
			{
				value: 'advanced',
				label: 'Advanced',
				description:
					'Profiles, defaults, refresh, and diagnostic browsing',
			},
		],
		footer: 'enter opens • esc close/back',
	});
}
