import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { homedir } from 'node:os';
import {
	redact_value,
	safe_json,
	truncate_json_value,
} from './redact.js';
import type {
	ObservabilityConfig,
	ObservabilityEvent,
	ObservabilityEventType,
	SessionInfo,
} from './types.js';

export { redact_text, redact_value } from './redact.js';
export type {
	ObservabilityConfig,
	ObservabilityEvent,
} from './types.js';

const DEFAULT_MAX_PAYLOAD_BYTES = 32_768;
const DEFAULT_POOL = 'default';
const DEFAULT_BATCH_SIZE = 50;
const DEFAULT_MAX_QUEUE_SIZE = 10_000;
export const DEFAULT_OBSERVABILITY_URL = 'http://127.0.0.1:43190';

function as_string(value: unknown): string | undefined {
	return typeof value === 'string' && value.length > 0
		? value
		: undefined;
}

function as_boolean(value: unknown): boolean {
	return value === true || value === 'true' || value === '1';
}

export function parse_tags(value: unknown): string[] {
	if (Array.isArray(value)) {
		return value.flatMap((item) => parse_tags(item));
	}
	if (typeof value !== 'string') return [];
	return value
		.split(',')
		.map((tag) => tag.trim())
		.filter(Boolean);
}

export function resolve_observability_config(
	pi: Pick<ExtensionAPI, 'getFlag'>,
	env: NodeJS.ProcessEnv = process.env,
): ObservabilityConfig | null {
	if (as_boolean(pi.getFlag('observability-disable'))) return null;
	if (as_boolean(env.MY_PI_OBSERVABILITY_DISABLE)) return null;

	const configured_server_url =
		as_string(pi.getFlag('observability-url')) ??
		env.MY_PI_OBSERVABILITY_URL ??
		env.PI_OBSERVABILITY_URL;

	return {
		server_url: configured_server_url ?? DEFAULT_OBSERVABILITY_URL,
		token:
			as_string(pi.getFlag('observability-token')) ??
			env.MY_PI_OBSERVABILITY_TOKEN ??
			env.PI_OBSERVABILITY_TOKEN,
		pool:
			as_string(pi.getFlag('observability-pool')) ??
			env.MY_PI_OBSERVABILITY_POOL ??
			env.PI_OBSERVABILITY_POOL ??
			DEFAULT_POOL,
		tags: [
			...parse_tags(pi.getFlag('observability-tag')),
			...parse_tags(
				env.MY_PI_OBSERVABILITY_TAG ?? env.PI_OBSERVABILITY_TAG,
			),
		],
		agent_name:
			as_string(pi.getFlag('observability-name')) ??
			env.MY_PI_OBSERVABILITY_NAME ??
			env.PI_OBSERVABILITY_NAME,
		raw_payloads:
			as_boolean(pi.getFlag('observability-raw')) ||
			as_boolean(env.MY_PI_OBSERVABILITY_RAW),
		max_payload_bytes: Number(
			env.MY_PI_OBSERVABILITY_MAX_PAYLOAD_BYTES ??
				DEFAULT_MAX_PAYLOAD_BYTES,
		),
		auto_start_server: !configured_server_url,
	};
}

export type DashboardCommand = 'web' | 'tui' | 'url';

export function resolve_dashboard_command(
	args: string,
): DashboardCommand {
	const command = args.trim().toLowerCase();
	if (command === 'tui') return 'tui';
	if (command === 'url') return 'url';
	return 'web';
}

export function summarize_payload(event: unknown): unknown {
	if (!event || typeof event !== 'object') return event;
	const object = event as Record<string, unknown>;
	const summary: Record<string, unknown> = {};
	for (const key of [
		'reason',
		'turnIndex',
		'toolName',
		'toolCallId',
		'isError',
		'status',
		'model',
		'previousSessionFile',
	] as const) {
		if (key in object) summary[key] = object[key];
	}
	for (const [key, value] of Object.entries(object)) {
		if (key in summary) continue;
		if (typeof value === 'string') {
			summary[key] =
				value.length > 500 ? `${value.slice(0, 500)}…` : value;
		} else if (Array.isArray(value)) {
			summary[key] = { type: 'array', length: value.length };
		} else if (value && typeof value === 'object') {
			summary[key] = {
				type: 'object',
				keys: Object.keys(value).slice(0, 20),
			};
		} else {
			summary[key] = value;
		}
	}
	return summary;
}

export function create_event_envelope(
	type: ObservabilityEventType,
	payload: unknown,
	session: SessionInfo,
	seq: number,
	config: Pick<
		ObservabilityConfig,
		'raw_payloads' | 'max_payload_bytes'
	>,
): ObservabilityEvent {
	const safe_payload = config.raw_payloads
		? payload
		: summarize_payload(payload);
	return {
		event_id: randomUUID(),
		ts: new Date().toISOString(),
		type,
		session_id: session.session_id,
		session_file: session.session_file,
		cwd: session.cwd,
		agent_name: session.agent_name,
		pool: session.pool,
		tags: session.tags,
		provider: session.provider,
		model: session.model,
		seq,
		payload: truncate_json_value(
			redact_value(safe_payload),
			config.max_payload_bytes,
		),
	};
}

async function local_server_is_running(
	url: string,
): Promise<boolean> {
	try {
		const response = await fetch(`${url.replace(/\/+$/, '')}/health`);
		return response.ok;
	} catch {
		return false;
	}
}

async function ensure_local_server(url: string): Promise<void> {
	if (await local_server_is_running(url)) return;
	const { start_observability_server } = await import('./server.js');
	start_observability_server({
		host: '127.0.0.1',
		port: new URL(url).port ? Number(new URL(url).port) : 43190,
		token: process.env.MY_PI_OBSERVABILITY_TOKEN ?? '',
		db_path:
			process.env.MY_PI_OBSERVABILITY_DB ??
			`${homedir()}/.pi/agent/observability.db`,
		log: false,
	});
}

export function open_dashboard(url: string): void {
	const command =
		process.platform === 'darwin'
			? 'open'
			: process.platform === 'win32'
				? 'cmd'
				: 'xdg-open';
	const args =
		process.platform === 'win32' ? ['/c', 'start', '', url] : [url];
	const child = spawn(command, args, {
		detached: true,
		stdio: 'ignore',
	});
	child.unref();
}

export class EventQueue {
	private queue: ObservabilityEvent[] = [];
	private timer: NodeJS.Timeout | null = null;
	private backoff_ms = 250;
	private flushing = false;

	constructor(
		private readonly server_url: string,
		private readonly token: string | undefined,
		private readonly batch_size = DEFAULT_BATCH_SIZE,
		private readonly max_queue_size = DEFAULT_MAX_QUEUE_SIZE,
	) {}

	push(event: ObservabilityEvent): void {
		if (this.queue.length >= this.max_queue_size) this.queue.shift();
		this.queue.push(event);
		if (this.queue.length >= this.batch_size) void this.flush();
		else this.schedule();
	}

	private schedule(): void {
		if (this.timer) return;
		this.timer = setTimeout(() => {
			this.timer = null;
			void this.flush();
		}, this.backoff_ms);
	}

	async flush(): Promise<void> {
		if (this.flushing || this.queue.length === 0) return;
		this.flushing = true;
		const batch = this.queue.slice(0, this.batch_size);
		try {
			const headers: Record<string, string> = {
				'content-type': 'application/json',
			};
			if (this.token) headers.authorization = `Bearer ${this.token}`;
			const response = await fetch(
				`${this.server_url.replace(/\/+$/, '')}/events`,
				{
					method: 'POST',
					headers,
					body: safe_json(batch),
				},
			);
			if (!response.ok) throw new Error(`HTTP ${response.status}`);
			this.queue.splice(0, batch.length);
			this.backoff_ms = 250;
		} catch {
			this.backoff_ms = Math.min(this.backoff_ms * 2, 5_000);
		} finally {
			this.flushing = false;
			if (this.queue.length > 0) this.schedule();
		}
	}

	async stop(): Promise<void> {
		if (this.timer) clearTimeout(this.timer);
		this.timer = null;
		await this.flush();
	}
}

export default function observability(pi: ExtensionAPI) {
	pi.registerFlag('observability-url', {
		description:
			'Live observability server URL (or MY_PI_OBSERVABILITY_URL)',
		type: 'string',
		default: undefined,
	});
	pi.registerFlag('observability-token', {
		description: 'Bearer token for the observability server',
		type: 'string',
		default: undefined,
	});
	pi.registerFlag('observability-pool', {
		description: 'Logical pool for grouping observed sessions',
		type: 'string',
		default: undefined,
	});
	pi.registerFlag('observability-tag', {
		description: 'Comma-separated observation tags',
		type: 'string',
		default: undefined,
	});
	pi.registerFlag('observability-name', {
		description: 'Friendly name for this observed session',
		type: 'string',
		default: undefined,
	});
	pi.registerFlag('observability-raw', {
		description: 'Send larger raw event payloads after redaction',
		type: 'boolean',
		default: false,
	});
	pi.registerFlag('observability-disable', {
		description: 'Disable live observability for this process',
		type: 'boolean',
		default: false,
	});

	let dashboard_url = DEFAULT_OBSERVABILITY_URL;
	pi.registerCommand('observability', {
		description:
			'Open the web observability dashboard; use "tui" for terminal view',
		handler: async (args, ctx) => {
			const command = resolve_dashboard_command(args);
			if (config?.auto_start_server)
				await ensure_local_server(config.server_url);
			const url = config?.server_url ?? dashboard_url;
			dashboard_url = url;
			if (command === 'url') {
				ctx.ui.notify(`Observability dashboard: ${url}`, 'info');
				return;
			}
			if (command === 'tui') {
				try {
					const { show_observability_tui_dashboard } =
						await import('./tui-dashboard.js');
					await show_observability_tui_dashboard(
						ctx,
						url,
						config?.token,
					);
				} catch (error) {
					ctx.ui.notify(
						error instanceof Error
							? `Observability TUI failed: ${error.message}`
							: `Observability dashboard: ${url}`,
						'error',
					);
				}
				return;
			}
			try {
				open_dashboard(url);
				ctx.ui.notify(`Observability dashboard: ${url}`, 'info');
			} catch {
				ctx.ui.notify(`Open observability dashboard: ${url}`, 'info');
			}
		},
	});

	let config: ObservabilityConfig | null = null;
	let queue: EventQueue | null = null;
	let session: SessionInfo | null = null;
	let seq = 0;

	function emit(
		type: ObservabilityEventType,
		payload: unknown,
	): void {
		if (!config || !queue || !session) return;
		queue.push(
			create_event_envelope(type, payload, session, seq++, config),
		);
	}

	function observe(
		pi_event: string,
		obs_type: ObservabilityEventType,
	): void {
		(
			pi.on as (
				name: string,
				handler: (event: unknown) => void,
			) => void
		)(pi_event, (event) => emit(obs_type, event));
	}

	pi.on('session_start', async (event, ctx) => {
		config = resolve_observability_config(pi);
		if (!config) return;
		dashboard_url = config.server_url;
		if (config.auto_start_server)
			await ensure_local_server(config.server_url);
		seq = 0;
		session = {
			session_id: ctx.sessionManager.getSessionId(),
			session_file: ctx.sessionManager.getSessionFile(),
			cwd: ctx.cwd,
			agent_name: config.agent_name,
			pool: config.pool,
			tags: config.tags,
			provider: ctx.model?.provider,
			model: ctx.model?.id,
		};
		queue = new EventQueue(config.server_url, config.token);
		emit('session_start', event);
	});

	observe('before_agent_start', 'agent_start');
	observe('agent_end', 'agent_end');
	observe('turn_start', 'turn_start');
	observe('turn_end', 'turn_end');
	observe('message_start', 'message_start');
	observe('message_end', 'message_end');
	observe('tool_call', 'tool_call');
	observe('tool_result', 'tool_result');
	observe('tool_execution_start', 'tool_execution_start');
	observe('tool_execution_update', 'tool_execution_update');
	observe('tool_execution_end', 'tool_execution_end');
	observe('before_provider_request', 'provider_request');
	observe('after_provider_response', 'provider_response');
	observe('session_compact', 'compaction');
	observe('session_tree', 'branch_nav');

	pi.on('model_select', async (event, ctx) => {
		if (session) {
			session.provider = ctx.model?.provider ?? session.provider;
			session.model = ctx.model?.id ?? session.model;
		}
		emit('model_select', event);
	});

	pi.on('session_shutdown', async (event) => {
		emit('session_shutdown', event);
		await queue?.stop();
		queue = null;
		session = null;
	});
}
