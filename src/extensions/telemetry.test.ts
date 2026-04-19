import { describe, expect, it } from 'vitest';
import {
	format_telemetry_query_results,
	format_telemetry_stats,
	format_telemetry_status,
	infer_run_outcome,
	parse_telemetry_command,
} from './telemetry.js';

describe('format_telemetry_status', () => {
	it('includes saved state, effective state, override, and db path', () => {
		expect(
			format_telemetry_status({
				saved_enabled: false,
				effective_enabled: true,
				override: true,
				db_path: '/tmp/telemetry.db',
			}),
		).toBe(
			[
				'telemetry enabled now',
				'default disabled',
				'override --telemetry',
				'db /tmp/telemetry.db',
			].join('\n'),
		);
	});
});

describe('format_telemetry_stats', () => {
	it('formats counts, schema version, and db sizes', () => {
		expect(
			format_telemetry_stats({
				db_path: '/tmp/telemetry.db',
				stats: {
					runs: 2,
					turns: 5,
					tool_calls: 8,
					provider_requests: 3,
					schema_version: 1,
					db_bytes: 2048,
					wal_bytes: 512,
					total_bytes: 2560,
				},
			}),
		).toBe(
			[
				'db /tmp/telemetry.db',
				'schema v1',
				'runs 2',
				'turns 5',
				'tool_calls 8',
				'provider_requests 3',
				'db_bytes 2.0 KiB',
				'wal_bytes 512 B',
				'total_bytes 2.5 KiB',
			].join('\n'),
		);
	});
});

describe('parse_telemetry_command', () => {
	it('parses query filters and default limit', () => {
		expect(
			parse_telemetry_command(
				'query run=eval-1 case=case-2 suite=smoke success=false',
			),
		).toEqual({
			subcommand: 'query',
			export_path: null,
			filters: {
				eval_run_id: 'eval-1',
				eval_case_id: 'case-2',
				eval_suite: 'smoke',
				success: false,
				limit: 20,
			},
			errors: [],
		});
	});

	it('parses export path and explicit limit', () => {
		expect(
			parse_telemetry_command(
				'export ./tmp/out.json success=true limit=5',
			),
		).toEqual({
			subcommand: 'export',
			export_path: './tmp/out.json',
			filters: {
				success: true,
				limit: 5,
			},
			errors: [],
		});
	});

	it('reports invalid filter values', () => {
		expect(
			parse_telemetry_command('query success=maybe limit=0 foo=bar'),
		).toEqual({
			subcommand: 'query',
			export_path: null,
			filters: {
				limit: 20,
			},
			errors: [
				'Invalid success value: maybe. Use true, false, or null',
				'Invalid limit value: 0. Use a positive integer',
				'Unknown filter: foo',
			],
		});
	});
});

describe('format_telemetry_query_results', () => {
	it('formats matching runs for display', () => {
		const output = format_telemetry_query_results({
			db_path: '/tmp/telemetry.db',
			filters: { eval_run_id: 'eval-1', limit: 2 },
			runs: [
				{
					id: 'run-1',
					session_file: null,
					cwd: '/tmp/project',
					started_at: Date.parse('2026-04-19T12:00:00.000Z'),
					ended_at: Date.parse('2026-04-19T12:00:02.500Z'),
					duration_ms: 2500,
					model_provider: 'anthropic',
					model_id: 'claude-sonnet',
					eval_run_id: 'eval-1',
					eval_case_id: 'case-1',
					eval_attempt: 1,
					eval_suite: 'smoke',
					success: true,
					error_message: null,
					turn_count: 2,
					tool_call_count: 3,
					tool_error_count: 1,
					provider_request_count: 2,
				},
			],
		});

		expect(output).toContain('db /tmp/telemetry.db');
		expect(output).toContain('filters eval_run_id=eval-1 limit=2');
		expect(output).toContain('2026-04-19T12:00:00.000Z run-1');
		expect(output).toContain('status=success');
		expect(output).toContain('duration=2.5s');
		expect(output).toContain('tool_errors=1');
	});

	it('formats empty query results', () => {
		expect(
			format_telemetry_query_results({
				db_path: '/tmp/telemetry.db',
				filters: {},
				runs: [],
			}),
		).toBe(
			[
				'db /tmp/telemetry.db',
				'filters none',
				'no matching runs',
			].join('\n'),
		);
	});
});

describe('infer_run_outcome', () => {
	it('marks aborted assistant runs as failures', () => {
		expect(
			infer_run_outcome({
				type: 'agent_end',
				messages: [
					{
						role: 'assistant',
						content: [],
						stopReason: 'aborted',
						errorMessage: 'Request was aborted',
					},
				],
			} as any),
		).toEqual({
			success: false,
			error_message: 'Request was aborted',
		});
	});

	it('marks successful assistant runs as success', () => {
		expect(
			infer_run_outcome({
				type: 'agent_end',
				messages: [
					{
						role: 'assistant',
						content: [],
						stopReason: 'end_turn',
					},
				],
			} as any),
		).toEqual({
			success: true,
			error_message: null,
		});
	});
});
