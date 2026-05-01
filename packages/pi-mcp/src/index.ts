import {
	defineTool,
	type BeforeAgentStartEvent,
	type ExtensionAPI,
	type ExtensionCommandContext,
	type ExtensionContext,
} from '@mariozechner/pi-coding-agent';
import {
	resolve_project_trust,
	type ProjectTrustSubject,
} from '@spences10/pi-project-trust';
import {
	show_confirm_modal,
	show_input_modal,
	show_picker_modal,
	show_settings_modal,
	show_text_modal,
} from '@spences10/pi-tui-modal';
import { McpClient, type McpServerConfig } from './client.js';
import {
	create_mcp_config_backup,
	get_project_mcp_config_info,
	list_mcp_config_backups,
	list_mcp_profiles,
	load_mcp_config,
	load_mcp_profile,
	restore_mcp_config_backup,
	save_mcp_profile,
	set_mcp_server_enabled,
	type McpConfigScope,
	type McpProjectConfigInfo,
} from './config.js';
import { create_mcp_tool_registration_metadata } from './metadata.js';
import { format_mcp_tool_result } from './result.js';
import {
	create_mcp_project_trust_subject,
	default_mcp_trust_store_path,
	is_project_mcp_config_trusted,
} from './trust.js';

const PROJECT_MCP_CONFIG_ENV = 'MY_PI_MCP_PROJECT_CONFIG';
const ENABLED = '● enabled';
const DISABLED = '○ disabled';

interface ServerState {
	config: McpServerConfig;
	client?: McpClient;
	tool_names: string[];
	enabled: boolean;
	status: 'disconnected' | 'connecting' | 'connected' | 'failed';
	error?: string;
	connect_promise?: Promise<void>;
}

function create_server_states(
	configs: McpServerConfig[],
): Map<string, ServerState> {
	return new Map(
		configs.map((config) => [
			config.name,
			{
				config,
				tool_names: [],
				enabled: config.disabled !== true,
				status: 'disconnected' as const,
			},
		]),
	);
}

function remove_server_tools_from_active(
	pi: ExtensionAPI,
	tool_names: string[],
): void {
	const tool_set = new Set(tool_names);
	pi.setActiveTools(
		pi.getActiveTools().filter((tool) => !tool_set.has(tool)),
	);
}

function format_server_status(state: ServerState): string {
	switch (state.status) {
		case 'connected':
			return state.enabled ? 'enabled' : 'disabled';
		case 'connecting':
			return state.enabled ? 'connecting' : 'connecting, disabled';
		case 'failed':
			return state.enabled ? 'failed' : 'failed, disabled';
		default:
			return state.enabled ? 'not connected yet' : 'disabled';
	}
}

function redact_url(value: string): string {
	try {
		const url = new URL(value);
		if (url.username) url.username = '***';
		if (url.password) url.password = '***';
		for (const key of url.searchParams.keys()) {
			if (/token|key|secret|password|auth/i.test(key)) {
				url.searchParams.set(key, '***');
			}
		}
		return url.toString();
	} catch {
		return value.replace(
			/(token|key|secret|password|auth)=([^\s&]+)/gi,
			'$1=***',
		);
	}
}

function summarize_mcp_tool_params(params: unknown): string | null {
	try {
		const json = JSON.stringify(params);
		if (!json) return null;
		return json.length > 500 ? `${json.slice(0, 497)}...` : json;
	} catch {
		return null;
	}
}

function format_server_target(config: McpServerConfig): string {
	if (config.transport === 'http') return redact_url(config.url);
	return [config.command, ...(config.args ?? [])].join(' ');
}

function count_pending_enabled_servers(
	servers: ReadonlyMap<string, ServerState>,
): number {
	return Array.from(servers.values()).filter(
		(state) => state.enabled && state.status !== 'connected',
	).length;
}

function report_mcp_failure(
	state: ServerState,
	ctx?: ExtensionContext,
): void {
	const message = `MCP server failed (${state.config.name}): ${state.error}`;
	if (ctx?.hasUI) {
		ctx.ui.notify(message, 'warning');
		return;
	}
	console.error(message);
}

function themed(
	ctx: ExtensionContext,
	color: 'accent' | 'dim' | 'muted',
	text: string,
): string {
	try {
		return ctx.ui.theme.fg(color, text);
	} catch {
		return text;
	}
}

function update_mcp_status(
	ctx: ExtensionContext,
	servers: ReadonlyMap<string, ServerState>,
): void {
	if (!ctx.hasUI) return;
	if (servers.size === 0) {
		ctx.ui.setStatus('mcp', undefined);
		return;
	}

	const states = Array.from(servers.values());
	const enabled = states.filter((state) => state.enabled).length;
	const connected = states.filter(
		(state) => state.enabled && state.status === 'connected',
	).length;
	const connecting = states.filter(
		(state) => state.enabled && state.status === 'connecting',
	).length;
	const failed = states.filter(
		(state) => state.enabled && state.status === 'failed',
	).length;

	const fragments = [`MCP ${connected}/${enabled} connected`];
	if (connecting > 0) fragments.push(`${connecting} connecting`);
	if (failed > 0) fragments.push(`${failed} failed`);

	ctx.ui.setStatus('mcp', themed(ctx, 'dim', fragments.join(' · ')));
}

function set_connect_feedback(
	ctx: ExtensionContext,
	pending_server_count: number,
): () => void {
	if (!ctx.hasUI) {
		return () => {};
	}

	const label =
		pending_server_count === 1
			? 'Connecting 1 MCP server...'
			: `Connecting ${pending_server_count} MCP servers...`;

	ctx.ui.setWorkingMessage(label);
	ctx.ui.setWorkingIndicator({
		frames: [
			themed(ctx, 'dim', '·'),
			themed(ctx, 'muted', '•'),
			themed(ctx, 'accent', '●'),
			themed(ctx, 'muted', '•'),
		],
		intervalMs: 120,
	});
	ctx.ui.setStatus('mcp', themed(ctx, 'dim', label));

	return () => {
		ctx.ui.setWorkingMessage();
		ctx.ui.setWorkingIndicator();
	};
}

export function should_wait_for_mcp_connections(
	event: Pick<BeforeAgentStartEvent, 'systemPromptOptions'>,
): boolean {
	const selected_tools = event.systemPromptOptions?.selectedTools;
	return (
		!selected_tools ||
		selected_tools.some((tool) => tool.startsWith('mcp__'))
	);
}

interface ProjectMcpConfigLoadDecision {
	include_project: boolean;
	metadata_trusted: boolean;
}

function create_project_mcp_trust_subject(
	info: McpProjectConfigInfo,
): ProjectTrustSubject {
	const server_lines =
		info.servers.length === 0
			? ['- no valid server entries detected']
			: info.servers.map(
					(server) => `- ${server.name}: ${server.summary}`,
				);
	return {
		...create_mcp_project_trust_subject(info.path, info.hash),
		summary_lines: server_lines,
		choices: {
			allow_once: 'Allow once for this session',
			trust: 'Trust this repo until mcp.json changes',
			skip: 'Skip project MCP config',
		},
		headless_warning: `Skipping untrusted project MCP config: ${info.path}. Set ${PROJECT_MCP_CONFIG_ENV}=allow to enable it for this run.`,
	};
}

async function get_project_mcp_config_load_decision(
	cwd: string,
	ctx?: ExtensionContext,
): Promise<ProjectMcpConfigLoadDecision> {
	const skipped = { include_project: false, metadata_trusted: false };
	const info = get_project_mcp_config_info(cwd);
	if (!info) return skipped;
	if (is_project_mcp_config_trusted(info.path, info.hash)) {
		return { include_project: true, metadata_trusted: true };
	}

	const decision = await resolve_project_trust(
		create_project_mcp_trust_subject(info),
		{
			has_ui: ctx?.hasUI,
			select: ctx?.hasUI
				? async (message, choices) =>
						(await ctx.ui.select(message, choices)) ?? choices[2]
				: undefined,
			warn: console.warn,
			trust_store_path: default_mcp_trust_store_path(),
		},
	);

	if (decision.action === 'skip') return skipped;
	return {
		include_project: true,
		metadata_trusted: decision.metadata_trusted,
	};
}

// Default export for Pi Package / additionalExtensionPaths loading
export default async function mcp(pi: ExtensionAPI) {
	let initialized_cwd: string | null = null;
	let initialize_promise: Promise<void> | undefined;
	let servers = new Map<string, ServerState>();
	const registered_tool_names = new Set<string>();

	const ensure_servers = async (
		cwd: string,
		ctx?: ExtensionContext,
	): Promise<void> => {
		if (initialized_cwd !== null) return;
		if (initialize_promise) {
			await initialize_promise;
			return;
		}
		initialize_promise = (async () => {
			const project_decision =
				await get_project_mcp_config_load_decision(cwd, ctx);
			servers = create_server_states(
				load_mcp_config(cwd, {
					include_project: project_decision.include_project,
					project_metadata_trusted: project_decision.metadata_trusted,
				}),
			);
			initialized_cwd = cwd;
		})();
		try {
			await initialize_promise;
		} finally {
			initialize_promise = undefined;
		}
	};

	const connect_server = async (
		state: ServerState,
		ctx?: ExtensionContext,
	): Promise<void> => {
		if (state.status === 'connected') return;
		if (state.connect_promise) {
			await state.connect_promise;
			return;
		}

		state.connect_promise = (async () => {
			state.status = 'connecting';
			state.error = undefined;
			if (ctx) update_mcp_status(ctx, servers);

			const client = new McpClient(state.config);
			try {
				await client.connect();
				state.client = client;

				const mcp_tools = await client.listTools();
				const tool_names: string[] = [];

				for (const mcp_tool of mcp_tools) {
					const tool_name = `mcp__${state.config.name}__${mcp_tool.name}`;
					tool_names.push(tool_name);

					if (registered_tool_names.has(tool_name)) continue;
					registered_tool_names.add(tool_name);

					const metadata = create_mcp_tool_registration_metadata(
						state.config,
						mcp_tool,
					);

					pi.registerTool(
						defineTool({
							name: tool_name,
							label: metadata.label,
							description: metadata.description,
							parameters: metadata.parameters as Parameters<
								typeof defineTool
							>[0]['parameters'],
							execute: async (_id, params) => {
								const result = (await state.client!.callTool(
									mcp_tool.name,
									params as Record<string, unknown>,
								)) as {
									content?: Array<{
										type: string;
										text?: string;
									}>;
								};

								const formatted = format_mcp_tool_result(result, {
									tool_name,
									input_summary: summarize_mcp_tool_params(params),
								});

								return {
									content: [
										{ type: 'text' as const, text: formatted.text },
									],
									details: formatted.details,
								};
							},
						}),
					);
				}

				state.tool_names = tool_names;
				state.status = 'connected';
				if (!state.enabled) {
					remove_server_tools_from_active(pi, state.tool_names);
				}
			} catch (error) {
				state.status = 'failed';
				state.error =
					error instanceof Error ? error.message : String(error);
				state.client = undefined;
				await client.disconnect().catch(() => {});
				report_mcp_failure(state, ctx);
				throw error;
			} finally {
				state.connect_promise = undefined;
				if (ctx) update_mcp_status(ctx, servers);
			}
		})();

		await state.connect_promise;
	};

	const connect_all_servers = async (
		options: {
			include_failed?: boolean;
			ctx?: ExtensionContext;
		} = {},
	): Promise<void> => {
		await Promise.allSettled(
			Array.from(servers.values())
				.filter((state) => state.enabled)
				.filter(
					(state) =>
						options.include_failed || state.status !== 'failed',
				)
				.map((state) => connect_server(state, options.ctx)),
		);
		if (options.ctx) update_mcp_status(options.ctx, servers);
	};

	const set_server_enabled = (
		name: string,
		enabled: boolean,
		ctx: ExtensionCommandContext,
	): ServerState | undefined => {
		const server = servers.get(name);
		if (!server) return undefined;
		server.enabled = enabled;
		server.config.disabled = !enabled;
		set_mcp_server_enabled(ctx.cwd, name, enabled);
		if (!enabled) {
			remove_server_tools_from_active(pi, server.tool_names);
			update_mcp_status(ctx, servers);
			return server;
		}
		if (server.status === 'connected') {
			const active = pi.getActiveTools();
			pi.setActiveTools([
				...new Set([...active, ...server.tool_names]),
			]);
			update_mcp_status(ctx, servers);
			return server;
		}
		if (server.status === 'failed') {
			server.status = 'disconnected';
			server.error = undefined;
		}
		update_mcp_status(ctx, servers);
		void connect_server(server, ctx);
		return server;
	};

	const format_mcp_server_list = (): string => {
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
	};

	const show_mcp_home_modal = async (
		ctx: ExtensionCommandContext,
	): Promise<string | undefined> =>
		await show_picker_modal(ctx, {
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

	const show_mcp_text_modal = async (
		ctx: ExtensionCommandContext,
		title: string,
		text: string,
	): Promise<void> => {
		await show_text_modal(ctx, {
			title,
			text,
			max_visible_lines: 20,
			overlay_options: { width: '90%', minWidth: 72 },
		});
	};

	const show_mcp_server_modal = async (
		ctx: ExtensionCommandContext,
	): Promise<boolean> => {
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
				const enabled = states.filter(
					(state) => state.enabled,
				).length;
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
				return [
					`Target: ${format_server_target(server.config)}`,
					`Status: ${format_server_status(server)}`,
					`Tools: ${server.tool_names.length}`,
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
	};

	const reload_after_config_change = async (
		ctx: ExtensionCommandContext,
		message: string,
	): Promise<void> => {
		ctx.ui.notify(`${message} Reloading MCP extension...`, 'info');
		await ctx.reload();
	};

	const handle_mcp_backup = async (
		ctx: ExtensionCommandContext,
	): Promise<void> => {
		const backup = create_mcp_config_backup(ctx.cwd);
		ctx.ui.notify(
			`MCP backup created: ${backup.filename} (${backup.global_server_count} global, ${backup.project_server_count} project servers)`,
			'info',
		);
	};

	const confirm_mcp_action = async (
		ctx: ExtensionCommandContext,
		options: {
			title: string;
			message: string;
			confirm_label?: string;
		},
	): Promise<boolean> => {
		if (!ctx.hasUI) {
			return await ctx.ui.confirm(options.title, options.message);
		}
		return await show_confirm_modal(ctx, {
			title: options.title,
			message: options.message,
			confirm_label: options.confirm_label,
		});
	};

	const handle_mcp_restore = async (
		ctx: ExtensionCommandContext,
		requested_file?: string,
	): Promise<boolean> => {
		const backups = list_mcp_config_backups();
		if (backups.length === 0) {
			ctx.ui.notify('No MCP backups found', 'warning');
			return false;
		}

		let selected_path = requested_file
			? backups.find(
					(backup) =>
						backup.filename === requested_file ||
						backup.path === requested_file,
				)?.path
			: undefined;

		if (!selected_path) {
			selected_path = await show_picker_modal(ctx, {
				title: 'Restore MCP backup',
				subtitle:
					'Restores global and project MCP config exactly as captured',
				items: backups.map((backup) => ({
					value: backup.path,
					label: backup.filename,
					description: `${backup.global_server_count} global • ${backup.project_server_count} project • ${backup.created_at}`,
				})),
				empty_message: 'No MCP backups found',
			});
		}
		if (!selected_path) return false;

		const confirmed = await confirm_mcp_action(ctx, {
			title: 'Restore MCP backup?',
			message:
				'This replaces current global/project MCP config with the selected backup.',
			confirm_label: 'Restore backup',
		});
		if (!confirmed) return false;

		const restored = restore_mcp_config_backup(
			ctx.cwd,
			selected_path,
		);
		await reload_after_config_change(
			ctx,
			`Restored ${restored.filename}.`,
		);
		return true;
	};

	const handle_mcp_profile = async (
		ctx: ExtensionCommandContext,
		args: string[],
	): Promise<boolean> => {
		const action = args[0] ?? 'load';
		if (action === 'list') {
			const profiles = list_mcp_profiles();
			if (profiles.length === 0) {
				ctx.ui.notify('No MCP profiles saved');
				return false;
			}
			const text = profiles
				.map(
					(profile) =>
						`${profile.name} — ${profile.server_count} servers`,
				)
				.join('\n');
			if (ctx.hasUI)
				await show_mcp_text_modal(ctx, 'MCP profiles', text);
			else ctx.ui.notify(text);
			return false;
		}

		if (action === 'save') {
			const name =
				args[1] ??
				(ctx.hasUI
					? await show_input_modal(ctx, {
							title: 'Save MCP profile',
							label: 'Profile name',
							subtitle: 'letters, numbers, underscores, hyphens',
						})
					: await ctx.ui.input(
							'Save MCP profile',
							'letters, numbers, underscores, hyphens',
						));
			if (!name) return false;
			try {
				const profile = save_mcp_profile(ctx.cwd, name);
				ctx.ui.notify(
					`Saved MCP profile ${profile.name} (${profile.server_count} servers)`,
					'info',
				);
			} catch (error) {
				ctx.ui.notify(
					error instanceof Error ? error.message : String(error),
					'warning',
				);
			}
			return false;
		}

		if (action !== 'load') {
			ctx.ui.notify(
				'Unknown profile action. Use profile list, profile save, or profile load.',
				'warning',
			);
			return false;
		}

		const profiles = list_mcp_profiles();
		if (profiles.length === 0) {
			ctx.ui.notify('No MCP profiles saved', 'warning');
			return false;
		}
		let name = args[1];
		if (!name) {
			const selected = await show_picker_modal(ctx, {
				title: 'Load MCP profile',
				subtitle:
					'Applies saved servers to global MCP config by default',
				items: profiles.map((profile) => ({
					value: profile.name,
					label: profile.name,
					description: `${profile.server_count} servers${profile.created_at ? ` • ${profile.created_at}` : ''}`,
				})),
				empty_message: 'No MCP profiles saved',
			});
			if (!selected) return false;
			name = selected;
		}
		const scope = (
			args[2] === 'project' ? 'project' : 'global'
		) satisfies McpConfigScope;
		const confirmed = await confirm_mcp_action(ctx, {
			title: 'Load MCP profile?',
			message: `This replaces ${scope} MCP config with profile ${name}.`,
			confirm_label: 'Load profile',
		});
		if (!confirmed) return false;
		try {
			const profile = load_mcp_profile(ctx.cwd, name, scope);
			await reload_after_config_change(
				ctx,
				`Loaded MCP profile ${profile.name} (${profile.server_count} servers).`,
			);
			return true;
		} catch (error) {
			ctx.ui.notify(
				error instanceof Error ? error.message : String(error),
				'warning',
			);
			return false;
		}
	};

	pi.on('session_start', async (_event, ctx) => {
		await ensure_servers(ctx.cwd, ctx);
		update_mcp_status(ctx, servers);
		void connect_all_servers({ ctx });
	});

	pi.on('before_agent_start', async (event, ctx) => {
		await ensure_servers(ctx.cwd, ctx);
		if (!should_wait_for_mcp_connections(event)) {
			void connect_all_servers({ ctx });
			return event;
		}

		const pending_server_count =
			count_pending_enabled_servers(servers);
		if (pending_server_count === 0) {
			update_mcp_status(ctx, servers);
			return event;
		}

		const restore_feedback = set_connect_feedback(
			ctx,
			pending_server_count,
		);
		try {
			await connect_all_servers({ ctx });
			return event;
		} finally {
			restore_feedback();
			update_mcp_status(ctx, servers);
		}
	});

	pi.registerCommand('mcp', {
		description:
			'Manage MCP servers (modal, list, enable, disable, backup, restore, profiles)',
		getArgumentCompletions: (prefix) => {
			const parts = prefix.split(' ');
			if (parts.length <= 1) {
				return [
					'manage',
					'list',
					'enable',
					'disable',
					'backup',
					'restore',
					'profile',
					'profiles',
				]
					.filter((s) => s.startsWith(prefix))
					.map((s) => ({ value: s, label: s }));
			}
			if (parts[0] === 'profile') {
				return ['list', 'save', 'load']
					.filter((s) => s.startsWith(parts[1] || ''))
					.map((s) => ({ value: `profile ${s}`, label: s }));
			}
			if (parts[0] === 'enable' || parts[0] === 'disable') {
				const name_prefix = parts[1] || '';
				return Array.from(servers.keys())
					.filter((n) => n.startsWith(name_prefix))
					.map((n) => ({
						value: `${parts[0]} ${n}`,
						label: n,
					}));
			}
			return null;
		},
		handler: async (args, ctx) => {
			await ensure_servers(ctx.cwd, ctx);
			const parts = args.trim().split(/\s+/).filter(Boolean);
			if (parts.length === 0 && ctx.hasUI) {
				while (true) {
					const selected = await show_mcp_home_modal(ctx);
					if (!selected) return;
					if (selected === 'manage') {
						await show_mcp_server_modal(ctx);
					} else if (selected === 'list') {
						update_mcp_status(ctx, servers);
						await show_mcp_text_modal(
							ctx,
							'MCP servers',
							format_mcp_server_list(),
						);
					} else if (selected === 'backup') {
						await handle_mcp_backup(ctx);
					} else if (selected === 'restore') {
						if (await handle_mcp_restore(ctx)) return;
					} else if (selected.startsWith('profile ')) {
						if (
							await handle_mcp_profile(
								ctx,
								selected.split(/\s+/).slice(1),
							)
						) {
							return;
						}
					}
					await ensure_servers(ctx.cwd, ctx);
				}
			}
			const [sub, ...rest] = parts;
			const name = rest.join(' ');

			switch (sub || 'manage') {
				case 'manage':
				case 'toggle': {
					if (await show_mcp_server_modal(ctx)) return;
					ctx.ui.notify(
						'MCP modal requires interactive mode',
						'warning',
					);
					break;
				}
				case 'backup': {
					await handle_mcp_backup(ctx);
					break;
				}
				case 'restore': {
					await handle_mcp_restore(ctx, rest.join(' ') || undefined);
					break;
				}
				case 'profile':
				case 'profiles': {
					await handle_mcp_profile(
						ctx,
						sub === 'profiles' ? ['load', ...rest] : rest,
					);
					break;
				}
				case 'list': {
					const text = format_mcp_server_list();
					update_mcp_status(ctx, servers);
					if (ctx.hasUI)
						await show_mcp_text_modal(ctx, 'MCP servers', text);
					else ctx.ui.notify(text);
					break;
				}
				case 'enable': {
					const server = servers.get(name);
					if (!server) {
						ctx.ui.notify(`Unknown server: ${name}`, 'warning');
						return;
					}
					if (server.enabled && server.status !== 'failed') {
						ctx.ui.notify(`${name} already enabled`);
						return;
					}
					set_server_enabled(name, true, ctx);
					ctx.ui.notify(
						server.status === 'connected'
							? `Enabled ${name}`
							: `Enabling ${name} and connecting in background`,
					);
					break;
				}
				case 'disable': {
					const server = servers.get(name);
					if (!server) {
						ctx.ui.notify(`Unknown server: ${name}`, 'warning');
						return;
					}
					if (!server.enabled) {
						ctx.ui.notify(`${name} already disabled`);
						return;
					}
					set_server_enabled(name, false, ctx);
					ctx.ui.notify(`Disabled ${name}`);
					break;
				}
				default:
					ctx.ui.notify(
						`Unknown subcommand: ${sub}. Use manage, list, enable, disable, backup, restore, or profile.`,
						'warning',
					);
			}
		},
	});

	pi.on('session_shutdown', async (_event, ctx) => {
		await Promise.allSettled(
			Array.from(servers.values()).map(async (server) => {
				await server.connect_promise?.catch(() => {});
				await server.client?.disconnect();
				server.client = undefined;
				if (server.status !== 'failed') {
					server.status = 'disconnected';
				}
			}),
		);
		ctx.ui.setStatus('mcp', undefined);
	});
}
