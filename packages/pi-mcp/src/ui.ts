import type { ExtensionCommandContext } from '@earendil-works/pi-coding-agent';
import {
	show_command_output_modal,
	show_picker_modal,
	show_settings_modal,
} from '@spences10/pi-tui-modal';
import {
	DISABLED,
	ENABLED,
	format_server_status,
	format_server_target,
	type ServerState,
} from './server-state.js';

export function format_mcp_server_list(
	servers: Map<string, ServerState>,
): string {
	if (servers.size === 0) return 'No MCP servers configured';
	const lines: string[] = [];
	for (const [sname, state] of servers.entries()) {
		const trust_note =
			state.config.metadata_trusted === false
				? ' — untrusted metadata suppressed'
				: '';
		lines.push(
			`${sname} (${format_server_status(state)}) — ${state.tool_names.length} tools${trust_note}${state.error ? ` — ${state.error}` : ''}`,
		);
	}
	return lines.join('\n');
}

export async function show_mcp_home_modal(
	ctx: ExtensionCommandContext,
	servers: Map<string, ServerState>,
): Promise<string | undefined> {
	return await show_picker_modal(ctx, {
		title: 'MCP',
		subtitle: `${servers.size} configured server(s)`,
		items: [
			{
				value: 'manage',
				label: 'Manage servers',
				description: 'Enable, disable, inspect status and tools',
			},
			{
				value: 'list',
				label: 'List servers',
				description: 'Read-only status summary',
			},
			{
				value: 'backup',
				label: 'Create backup',
				description: 'Snapshot global and project MCP config',
			},
			{
				value: 'restore',
				label: 'Restore backup',
				description: 'Pick a saved MCP config backup',
			},
			{
				value: 'profile load',
				label: 'Load profile',
				description: 'Apply a saved MCP server profile',
			},
			{
				value: 'profile save',
				label: 'Save profile',
				description: 'Save current config as a named profile',
			},
			{
				value: 'profile list',
				label: 'List profiles',
				description: 'Show saved MCP profiles',
			},
		],
		footer: 'enter opens • esc close/back',
	});
}

export async function show_mcp_text_modal(
	ctx: ExtensionCommandContext,
	title: string,
	text: string,
): Promise<void> {
	await show_command_output_modal(ctx, { title, text });
}

export async function show_mcp_server_modal(
	ctx: ExtensionCommandContext,
	servers: Map<string, ServerState>,
	set_server_enabled: (
		name: string,
		enabled: boolean,
		ctx: ExtensionCommandContext,
	) => ServerState | undefined,
): Promise<boolean> {
	if (!ctx.hasUI) return false;
	if (servers.size === 0) {
		ctx.ui.notify('No MCP servers configured');
		return true;
	}

	const items = Array.from(servers.values()).map((state) => ({
		id: state.config.name,
		label: state.config.name,
		currentValue: state.enabled ? ENABLED : DISABLED,
		values: [ENABLED, DISABLED],
		description: format_server_target(state.config),
	}));

	await show_settings_modal(ctx, {
		title: 'MCP servers',
		subtitle: () => {
			const states = Array.from(servers.values());
			const enabled = states.filter((state) => state.enabled).length;
			const connected = states.filter(
				(state) => state.enabled && state.status === 'connected',
			).length;
			const failed = states.filter(
				(state) => state.enabled && state.status === 'failed',
			).length;
			return `${enabled}/${states.length} enabled • ${connected} connected${failed ? ` • ${failed} failed` : ''}`;
		},
		items,
		enable_search: true,
		detail: (item) => {
			const server = servers.get(item.id);
			if (!server) return undefined;
			return `${format_server_status(server)} • ${server.tool_names.length} tools • ${server.config.transport}`;
		},
		metadata: (item) => {
			if (!item) return undefined;
			const server = servers.get(item.id);
			if (!server) return undefined;
			const sampling = server.constrained_sampling;
			const reasons = Object.entries(sampling.reasons)
				.filter(([reason]) => reason !== 'eligible')
				.map(([reason, count]) => `${reason}:${count}`)
				.join(', ');
			return [
				`Target: ${format_server_target(server.config)}`,
				`Status: ${format_server_status(server)}`,
				`Tools: ${server.tool_names.length}`,
				`Strict sampling: ${sampling.eligible} eligible, ${sampling.normal} normal${reasons ? ` (${reasons})` : ''}`,
				server.config.metadata_trusted === false
					? 'Metadata: untrusted metadata suppressed'
					: 'Metadata: trusted',
				...(server.error ? [`Error: ${server.error}`] : []),
			];
		},
		footer:
			'enter/space toggles • search filters • changes save to mcp.json • esc close',
		on_change: (id, new_value) => {
			set_server_enabled(id, new_value === ENABLED, ctx);
		},
	});

	return true;
}
