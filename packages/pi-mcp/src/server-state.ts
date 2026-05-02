import type {
	ExtensionAPI,
	ExtensionContext,
} from '@mariozechner/pi-coding-agent';
import { McpClient, type McpServerConfig } from './client.js';

export const ENABLED = '● enabled';
export const DISABLED = '○ disabled';

export interface ServerState {
	config: McpServerConfig;
	client?: McpClient;
	tool_names: string[];
	enabled: boolean;
	status: 'disconnected' | 'connecting' | 'connected' | 'failed';
	error?: string;
	connect_promise?: Promise<void>;
}

export function create_server_states(
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

export function remove_server_tools_from_active(
	pi: ExtensionAPI,
	tool_names: string[],
): void {
	const tool_set = new Set(tool_names);
	pi.setActiveTools(
		pi.getActiveTools().filter((tool) => !tool_set.has(tool)),
	);
}

export function format_server_status(state: ServerState): string {
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

export function redact_url(value: string): string {
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

export function summarize_mcp_tool_params(
	params: unknown,
): string | null {
	try {
		const json = JSON.stringify(params);
		if (!json) return null;
		return json.length > 500 ? `${json.slice(0, 497)}...` : json;
	} catch {
		return null;
	}
}

export function format_server_target(
	config: McpServerConfig,
): string {
	if (config.transport === 'http') return redact_url(config.url);
	return [config.command, ...(config.args ?? [])].join(' ');
}

export function count_pending_enabled_servers(
	servers: ReadonlyMap<string, ServerState>,
): number {
	return Array.from(servers.values()).filter(
		(state) => state.enabled && state.status !== 'connected',
	).length;
}

export function report_mcp_failure(
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

export function update_mcp_status(
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

export function set_connect_feedback(
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
