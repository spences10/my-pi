import { describe, expect, it } from 'vitest';
import {
	create_event_envelope,
	parse_tags,
	resolve_dashboard_command,
	resolve_observability_config,
	summarize_payload,
} from './index.js';
import { redact_value, truncate_json_value } from './redact.js';

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
	it('defaults to local auto-start without a server url', () => {
		expect(
			resolve_observability_config({ getFlag: () => undefined }, {}),
		).toMatchObject({
			server_url: 'http://127.0.0.1:43190',
			auto_start_server: true,
		});
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
