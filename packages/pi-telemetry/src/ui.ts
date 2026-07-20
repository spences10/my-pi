import type { ExtensionCommandContext } from '@earendil-works/pi-coding-agent';
import {
	show_command_output_modal,
	show_picker_modal,
} from '@spences10/pi-tui-modal';
import { resolve } from 'node:path';

export function get_default_telemetry_export_path(
	cwd: string,
): string {
	const stamp = new Date().toISOString().replace(/[:.]/g, '-');
	return resolve(cwd, `telemetry-export-${stamp}.json`);
}

export async function show_telemetry_text_modal(
	ctx: ExtensionCommandContext,
	title: string,
	text: string,
): Promise<void> {
	await show_command_output_modal(ctx, { title, text });
}

export async function show_telemetry_home_modal(
	ctx: ExtensionCommandContext,
	effective_enabled: boolean,
): Promise<string | undefined> {
	return await show_picker_modal(ctx, {
		title: 'Telemetry',
		subtitle: effective_enabled
			? 'enabled for this session'
			: 'disabled',
		items: [
			{
				value: 'status',
				label: 'Show status',
				description:
					'Enabled state, database path, and override source',
			},
			{
				value: 'stats',
				label: 'Show stats',
				description: 'Run and tool-call counts',
			},
			{
				value: 'runs',
				label: 'Recent runs',
				description: 'List recent telemetry records',
			},
			{
				value: 'export',
				label: 'Export JSON',
				description: 'Write recent telemetry to a JSON file',
			},
			{
				value: 'enable',
				label: 'Enable telemetry',
				description: 'Persist telemetry enabled=true',
			},
			{
				value: 'disable',
				label: 'Disable telemetry',
				description: 'Persist telemetry enabled=false',
			},
		],
		footer: 'enter opens • esc close/back',
	});
}
