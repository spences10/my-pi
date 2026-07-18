import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import observability, {
	create_event_envelope,
	parse_tags,
	resolve_dashboard_command,
	resolve_observability_config,
	summarize_payload,
} from './index.js';
import { redact_value, truncate_json_value } from './redact.js';
import type { ObservabilityEvent } from './types.js';

function observability_harness(options?: {
	configured_name?: string;
	session_name?: string;
}) {
	const handlers = new Map<
		string,
		(event: unknown, ctx: unknown) => Promise<void>
	>();
	let session_name = options?.session_name;
	const sent: ObservabilityEvent[] = [];
	const fetch_mock = vi
		.spyOn(globalThis, 'fetch')
		.mockImplementation(async (_input, init) => {
			if (typeof init?.body !== 'string')
				throw new TypeError('Expected a JSON request body');
			sent.push(...(JSON.parse(init.body) as ObservabilityEvent[]));
			return new Response(null, { status: 200 });
		});
	const flags = new Map<string, unknown>([
		['observability-url', 'http://observability.test'],
		...(options?.configured_name
			? ([['observability-name', options.configured_name]] as const)
			: []),
	]);
	const pi = {
		registerFlag: vi.fn(),
		registerCommand: vi.fn(),
		getFlag: (name: string) => flags.get(name),
		on: (name: string, handler: never) => handlers.set(name, handler),
	};
	observability(pi as never);
	const ctx = {
		cwd: '/repo',
		model: undefined,
		sessionManager: {
			getSessionId: () => 'session-1',
			getSessionFile: () => '/sessions/session-1.jsonl',
			getSessionName: () => session_name,
		},
	};
	return {
		fetch_mock,
		sent,
		set_session_name: (name: string) => (session_name = name),
		trigger: async (name: string, event: unknown = {}) =>
			handlers.get(name)?.(event, ctx),
	};
}

describe('parse_tags', () => {
	it('splits comma-separated values', () => {
		expect(parse_tags('alpha, beta,,gamma')).toEqual([
			'alpha',
			'beta',
			'gamma',
		]);
	});
});

describe('resolve_dashboard_command', () => {
	it('defaults to the web dashboard', () => {
		expect(resolve_dashboard_command('')).toBe('web');
		expect(resolve_dashboard_command('open')).toBe('web');
	});

	it('keeps explicit tui and url modes', () => {
		expect(resolve_dashboard_command('tui')).toBe('tui');
		expect(resolve_dashboard_command('url')).toBe('url');
	});
});

describe('resolve_observability_config', () => {
	it('defaults to authenticated local auto-start without a server url', () => {
		const home = mkdtempSync(join(tmpdir(), 'pi-obs-config-'));
		const config = resolve_observability_config(
			{ getFlag: () => undefined },
			{ HOME: home },
		);
		expect(config).toMatchObject({
			server_url: 'http://127.0.0.1:43190',
			auto_start_server: true,
		});
		expect(config?.token).toHaveLength(43);
	});

	it('stays disabled when explicitly disabled', () => {
		expect(
			resolve_observability_config(
				{ getFlag: (key) => key === 'observability-disable' },
				{},
			),
		).toBeNull();
	});

	it('uses flags and environment fallbacks', () => {
		const flags = new Map<string, unknown>([
			['observability-url', 'http://127.0.0.1:43190'],
			['observability-tag', 'one,two'],
		]);
		const config = resolve_observability_config(
			{
				getFlag: (key) =>
					flags.get(key) as string | boolean | undefined,
			},
			{
				MY_PI_OBSERVABILITY_POOL: 'test',
				MY_PI_OBSERVABILITY_DETAIL: 'summary',
			},
		);
		expect(config).toMatchObject({
			server_url: 'http://127.0.0.1:43190',
			pool: 'test',
			tags: ['one', 'two'],
			detail_level: 'summary',
			auto_start_server: false,
		});
	});
});

describe('payload safety', () => {
	it('redacts secret-looking keys recursively', () => {
		expect(
			redact_value({ nested: { api_key: 'abc', safe: 'ok' } }),
		).toEqual({ nested: { api_key: '[REDACTED]', safe: 'ok' } });
	});

	it('preserves useful nested detail by default', () => {
		expect(
			summarize_payload({
				toolName: 'bash',
				input: { command: 'pnpm test' },
				items: [1, 2, 3],
			}),
		).toMatchObject({
			toolName: 'bash',
			input: {
				type: 'object',
				keys: ['command'],
				command: 'pnpm test',
			},
			items: { type: 'array', length: 3 },
		});
	});

	it('can keep object-heavy payloads in summary mode', () => {
		expect(
			summarize_payload(
				{ toolName: 'bash', input: { command: 'pnpm test' } },
				'summary',
			),
		).toMatchObject({
			toolName: 'bash',
			input: { type: 'object', keys: ['command'] },
		});
	});

	it('preserves usage and cost metrics inside summarized messages', () => {
		expect(
			summarize_payload({
				message: {
					content: [{ type: 'text', text: 'ok' }],
					usage: {
						input: 1000,
						output: 25,
						totalTokens: 1025,
						cost: { total: 0.005 },
					},
				},
			}),
		).toMatchObject({
			message: {
				type: 'object',
				usage: {
					input: 1000,
					output: 25,
					totalTokens: 1025,
					cost: { total: 0.005 },
				},
			},
		});
	});

	it('truncates large json values', () => {
		expect(
			truncate_json_value({ text: 'x'.repeat(100) }, 20),
		).toEqual(expect.objectContaining({ truncated: true }));
	});
});

describe('session names', () => {
	it('uses the current name for initial and resumed sessions', async () => {
		const harness = observability_harness({ session_name: 'derek' });
		await harness.trigger('session_start');
		await harness.trigger('session_shutdown');
		expect(harness.sent[0]).toMatchObject({
			type: 'session_start',
			session_name: 'derek',
		});
		expect(harness.sent[0]?.agent_name).toBeUndefined();
		harness.fetch_mock.mockRestore();
	});

	it('emits renamed session metadata for normal persistence', async () => {
		const harness = observability_harness({ session_name: 'before' });
		await harness.trigger('session_start');
		harness.set_session_name('after');
		await harness.trigger('session_info_changed', { name: 'after' });
		await harness.trigger('session_shutdown');
		expect(harness.sent).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					type: 'session_info_changed',
					session_name: 'after',
				}),
			]),
		);
		harness.fetch_mock.mockRestore();
	});

	it('keeps an explicit observability name across session renames', async () => {
		const harness = observability_harness({
			configured_name: 'override',
			session_name: 'before',
		});
		await harness.trigger('session_start');
		harness.set_session_name('after');
		await harness.trigger('session_info_changed', { name: 'after' });
		await harness.trigger('session_shutdown');
		expect(
			harness.sent.find(
				(event) => event.type === 'session_info_changed',
			),
		).toMatchObject({
			agent_name: 'override',
			session_name: 'after',
		});
		harness.fetch_mock.mockRestore();
	});
});

describe('create_event_envelope', () => {
	it('adds ordering and session identity', () => {
		const event = create_event_envelope(
			'tool_call',
			{ toolName: 'read' },
			{
				session_id: 's1',
				cwd: '/tmp/project',
				pool: 'default',
				tags: ['demo'],
			},
			3,
			{
				raw_payloads: false,
				detail_level: 'detailed',
				max_payload_bytes: 1000,
			},
		);
		expect(event).toMatchObject({
			type: 'tool_call',
			session_id: 's1',
			seq: 3,
			cwd: '/tmp/project',
			payload: { toolName: 'read' },
		});
		expect(event.event_id).toEqual(expect.any(String));
	});
});
