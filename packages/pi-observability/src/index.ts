import type { ExtensionAPI } from '@earendil-works/pi-coding-agent';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import type { Server } from 'node:http';
import { homedir } from 'node:os';
import { authenticated_dashboard_url } from './dashboard-url.js';
import { health_proof_matches } from './health-auth.js';
import { resolve_observability_token } from './options.js';
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

function detail_level(
	value: unknown,
): ObservabilityConfig['detail_level'] {
	return value === 'summary' ? 'summary' : 'detailed';
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
		as_string(env.MY_PI_OBSERVABILITY_URL) ??
		as_string(env.PI_OBSERVABILITY_URL);
	const configured_token =
		as_string(pi.getFlag('observability-token')) ??
		as_string(env.MY_PI_OBSERVABILITY_TOKEN) ??
		as_string(env.PI_OBSERVABILITY_TOKEN);

	return {
		server_url: configured_server_url ?? DEFAULT_OBSERVABILITY_URL,
		token:
			configured_token ??
			(configured_server_url
				? undefined
				: resolve_observability_token(env)),
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
		detail_level: detail_level(
			pi.getFlag('observability-detail') ??
				env.MY_PI_OBSERVABILITY_DETAIL,
		),
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

function summarize_metric_value(value: unknown): unknown {
	if (!value || typeof value !== 'object') return value;
	if (Array.isArray(value))
		return { type: 'array', length: value.length };
	const summary: Record<string, unknown> = {};
	for (const [key, child] of Object.entries(value)) {
		if (
			typeof child === 'number' ||
			typeof child === 'string' ||
			typeof child === 'boolean'
		) {
			summary[key] = child;
		} else if (child && typeof child === 'object') {
			summary[key] = summarize_metric_value(child);
		}
	}
	return summary;
}

function summarize_text(value: string, limit: number): string {
	return value.length > limit ? `${value.slice(0, limit)}…` : value;
}

function detailed_object_summary(
	key: string,
	value: Record<string, unknown>,
): Record<string, unknown> {
	const summary: Record<string, unknown> = {
		type: 'object',
		keys: Object.keys(value).slice(0, 20),
	};
	for (const [child_key, child] of Object.entries(value)) {
		if (child_key === 'usage' || child_key === 'cost') {
			summary[child_key] = summarize_metric_value(child);
		} else if (
			[
				'model',
				'provider',
				'reasoning',
				'text',
				'tool_choice',
			].includes(child_key)
		) {
			summary[child_key] =
				typeof child === 'string'
					? summarize_text(child, 500)
					: summarize_metric_value(child);
		} else if (child_key === 'instructions') {
			summary[child_key] =
				typeof child === 'string'
					? summarize_text(child, 2000)
					: summarize_metric_value(child);
		} else if (
			key === 'input' &&
			(typeof child === 'string' ||
				typeof child === 'number' ||
				typeof child === 'boolean')
		) {
			summary[child_key] =
				typeof child === 'string'
					? summarize_text(child, 2000)
					: child;
		}
	}
	return summary;
}

export function summarize_payload(
	event: unknown,
	detail_level: ObservabilityConfig['detail_level'] = 'detailed',
): unknown {
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
		if (key === 'usage' || key === 'cost') {
			summary[key] = summarize_metric_value(value);
		} else if (typeof value === 'string') {
			summary[key] = summarize_text(
				value,
				key.toLowerCase().includes('prompt') ? 4000 : 500,
			);
		} else if (Array.isArray(value)) {
			summary[key] = { type: 'array', length: value.length };
		} else if (value && typeof value === 'object') {
			const nested = value as Record<string, unknown>;
			summary[key] =
				detail_level === 'summary'
					? {
							type: 'object',
							keys: Object.keys(nested).slice(0, 20),
							...('usage' in nested
								? { usage: summarize_metric_value(nested.usage) }
								: {}),
							...('cost' in nested
								? { cost: summarize_metric_value(nested.cost) }
								: {}),
						}
					: detailed_object_summary(key, nested);
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
		'raw_payloads' | 'detail_level' | 'max_payload_bytes'
	>,
): ObservabilityEvent {
	const safe_payload = config.raw_payloads
		? payload
		: summarize_payload(payload, config.detail_level);
	return {
		event_id: randomUUID(),
		ts: new Date().toISOString(),
		type,
		session_id: session.session_id,
		session_file: session.session_file,
		cwd: session.cwd,
		agent_name: session.agent_name,
		session_name: session.session_name,
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

type LocalServerStatus = 'authenticated' | 'absent' | 'untrusted';

async function local_server_status(
	url: string,
	token: string | undefined,
): Promise<LocalServerStatus> {
	if (!token) return 'untrusted';
	const challenge = randomUUID();
	try {
		const response = await fetch(
			`${url.replace(/\/+$/, '')}/health?challenge=${encodeURIComponent(challenge)}`,
		);
		if (!response.ok) return 'untrusted';
		const body = (await response.json()) as { proof?: unknown };
		return health_proof_matches(token, challenge, body.proof)
			? 'authenticated'
			: 'untrusted';
	} catch {
		return 'absent';
	}
}

async function wait_for_server_listening(
	server: Server,
): Promise<void> {
	if (server.listening) return;
	await new Promise<void>((resolve_listening, reject_listening) => {
		const on_listening = () => {
			server.off('error', on_error);
			resolve_listening();
		};
		const on_error = (error: Error) => {
			server.off('listening', on_listening);
			reject_listening(error);
		};
		server.once('listening', on_listening);
		server.once('error', on_error);
	});
}

async function ensure_local_server(
	url: string,
	token: string | undefined,
): Promise<void> {
	const status = await local_server_status(url, token);
	if (status === 'authenticated') return;
	if (status === 'untrusted') {
		throw new Error(
			`Observability endpoint at ${url} failed authentication`,
		);
	}

	const { start_observability_server } = await import('./server.js');
	const running = start_observability_server({
		host: '127.0.0.1',
		port: new URL(url).port ? Number(new URL(url).port) : 43190,
		token: token ?? '',
		db_path:
			process.env.MY_PI_OBSERVABILITY_DB ??
			`${homedir()}/.pi/agent/observability.db`,
		log: false,
		throw_on_listen_error: false,
	});
	await wait_for_server_listening(running.server);
	if ((await local_server_status(url, token)) !== 'authenticated') {
		await running.close();
		throw new Error(
			`Observability server at ${url} failed startup authentication`,
		);
	}
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
	pi.registerFlag('observability-detail', {
		description: 'Payload detail level: detailed or summary',
		type: 'string',
		default: undefined,
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
				await ensure_local_server(config.server_url, config.token);
			const url = config?.server_url ?? dashboard_url;
			const authorized_url = authenticated_dashboard_url(
				url,
				config?.token,
			);
			dashboard_url = url;
			if (command === 'url') {
				ctx.ui.notify(
					`Observability dashboard: ${authorized_url}`,
					'info',
				);
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
				open_dashboard(authorized_url);
				ctx.ui.notify(`Observability dashboard: ${url}`, 'info');
			} catch {
				ctx.ui.notify(
					`Open observability dashboard: ${authorized_url}`,
					'info',
				);
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
			await ensure_local_server(config.server_url, config.token);
		seq = 0;
		session = {
			session_id: ctx.sessionManager.getSessionId(),
			session_file: ctx.sessionManager.getSessionFile(),
			cwd: ctx.cwd,
			agent_name: config.agent_name,
			session_name: ctx.sessionManager.getSessionName(),
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

	pi.on('session_info_changed', async (event, ctx) => {
		if (session)
			session.session_name = ctx.sessionManager.getSessionName();
		emit('session_info_changed', event);
	});

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
