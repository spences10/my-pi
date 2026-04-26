import { existsSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { TelemetryDatabase } from './db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const TEST_DB_PATH = join(__dirname, 'telemetry-test.db');

describe('TelemetryDatabase', () => {
	let db: TelemetryDatabase | null;

	beforeEach(async () => {
		rmSync(TEST_DB_PATH, { force: true });
		db = await TelemetryDatabase.open(TEST_DB_PATH);
	});

	afterEach(() => {
		try {
			db?.close();
		} catch {
			// already closed in test
		}
		db = null;
		rmSync(TEST_DB_PATH, { force: true });
	});

	it('creates the database on open', () => {
		expect(existsSync(TEST_DB_PATH)).toBe(true);
		expect(db?.get_stats()).toMatchObject({
			runs: 0,
			turns: 0,
			tool_calls: 0,
			provider_requests: 0,
			schema_version: 1,
		});

		const version = db?.read_rows<{
			user_version: number;
		}>('PRAGMA user_version');
		expect(version).toEqual([{ user_version: 1 }]);

		const journal_mode = db?.read_rows<{
			journal_mode: string;
		}>('PRAGMA journal_mode');
		expect(journal_mode).toEqual([{ journal_mode: 'wal' }]);

		const busy_timeout = db?.read_rows<{
			timeout: number;
		}>('PRAGMA busy_timeout');
		expect(busy_timeout).toEqual([{ timeout: 5000 }]);
	});

	it('records a complete run lifecycle', () => {
		db?.insert_run({
			id: 'run-1',
			session_file: '/tmp/session.jsonl',
			cwd: '/tmp/project',
			started_at: 1,
			model_provider: 'anthropic',
			model_id: 'claude-sonnet',
			eval_run_id: 'eval-run',
			eval_case_id: 'case-1',
			eval_attempt: 2,
			eval_suite: 'smoke',
		});
		db?.insert_turn({
			id: 'run-1:turn:0',
			run_id: 'run-1',
			turn_index: 0,
			started_at: 2,
		});
		db?.insert_tool_call({
			tool_call_id: 'tool-1',
			run_id: 'run-1',
			turn_id: 'run-1:turn:0',
			tool_name: 'read',
			started_at: 3,
			args_summary_json: '{"path":"README.md"}',
		});
		db?.note_tool_update('tool-1');
		db?.finish_tool_call({
			tool_call_id: 'tool-1',
			ended_at: 4,
			is_error: false,
			result_summary_json: '{"bytes":42}',
			error_message: null,
		});
		db?.insert_provider_request({
			id: 'provider-1',
			run_id: 'run-1',
			turn_id: 'run-1:turn:0',
			started_at: 5,
			payload_summary_json: '{"keys":["messages"]}',
		});
		db?.finish_provider_request({
			id: 'provider-1',
			ended_at: 6,
			status_code: 200,
			headers_json: '{"count":3}',
		});
		db?.finish_turn({
			id: 'run-1:turn:0',
			ended_at: 7,
			tool_result_count: 1,
			stop_reason: 'end_turn',
		});
		db?.finish_run({
			id: 'run-1',
			ended_at: 8,
			success: true,
			error_message: null,
		});

		expect(db?.get_stats()).toMatchObject({
			runs: 1,
			turns: 1,
			tool_calls: 1,
			provider_requests: 1,
			schema_version: 1,
		});

		const runs = db?.read_rows<{
			id: string;
			model_provider: string;
			model_id: string;
			eval_case_id: string;
			success: number;
		}>(
			'SELECT id, model_provider, model_id, eval_case_id, success FROM runs',
		);
		expect(runs).toEqual([
			{
				id: 'run-1',
				model_provider: 'anthropic',
				model_id: 'claude-sonnet',
				eval_case_id: 'case-1',
				success: 1,
			},
		]);

		const tool_calls = db?.read_rows<{
			tool_call_id: string;
			partial_update_count: number;
			is_error: number;
		}>(
			'SELECT tool_call_id, partial_update_count, is_error FROM tool_calls',
		);
		expect(tool_calls).toEqual([
			{
				tool_call_id: 'tool-1',
				partial_update_count: 1,
				is_error: 0,
			},
		]);
	});

	it('queries runs with eval filters and aggregates', () => {
		db?.insert_run({
			id: 'run-query-1',
			session_file: null,
			cwd: '/tmp/project',
			started_at: 100,
			model_provider: 'anthropic',
			model_id: 'claude-sonnet',
			eval_run_id: 'eval-a',
			eval_case_id: 'case-a',
			eval_attempt: 1,
			eval_suite: 'smoke',
		});
		db?.insert_turn({
			id: 'run-query-1:turn:0',
			run_id: 'run-query-1',
			turn_index: 0,
			started_at: 101,
		});
		db?.insert_tool_call({
			tool_call_id: 'run-query-1:tool:1',
			run_id: 'run-query-1',
			turn_id: 'run-query-1:turn:0',
			tool_name: 'read',
			started_at: 102,
			args_summary_json: null,
		});
		db?.finish_tool_call({
			tool_call_id: 'run-query-1:tool:1',
			ended_at: 103,
			is_error: true,
			result_summary_json: null,
			error_message: 'boom',
		});
		db?.insert_provider_request({
			id: 'run-query-1:provider:1',
			run_id: 'run-query-1',
			turn_id: 'run-query-1:turn:0',
			started_at: 104,
			payload_summary_json: null,
		});
		db?.finish_provider_request({
			id: 'run-query-1:provider:1',
			ended_at: 105,
			status_code: 200,
			headers_json: null,
		});
		db?.finish_turn({
			id: 'run-query-1:turn:0',
			ended_at: 106,
			tool_result_count: 1,
			stop_reason: 'end_turn',
		});
		db?.finish_run({
			id: 'run-query-1',
			ended_at: 107,
			success: false,
			error_message: 'failed',
		});

		db?.insert_run({
			id: 'run-query-2',
			session_file: null,
			cwd: '/tmp/project',
			started_at: 200,
			model_provider: null,
			model_id: null,
			eval_run_id: 'eval-b',
			eval_case_id: 'case-b',
			eval_attempt: 1,
			eval_suite: 'full',
		});
		db?.finish_run({
			id: 'run-query-2',
			ended_at: 205,
			success: true,
			error_message: null,
		});

		expect(
			db?.query_runs({
				eval_run_id: 'eval-a',
				success: false,
				limit: 1,
			}),
		).toEqual([
			{
				id: 'run-query-1',
				session_file: null,
				cwd: '/tmp/project',
				started_at: 100,
				ended_at: 107,
				duration_ms: 7,
				model_provider: 'anthropic',
				model_id: 'claude-sonnet',
				eval_run_id: 'eval-a',
				eval_case_id: 'case-a',
				eval_attempt: 1,
				eval_suite: 'smoke',
				success: false,
				error_message: 'failed',
				turn_count: 1,
				tool_call_count: 1,
				tool_error_count: 1,
				provider_request_count: 1,
			},
		]);
	});

	it('stores nullable outcomes for interrupted runs', () => {
		db?.insert_run({
			id: 'run-2',
			session_file: null,
			cwd: '/tmp/project',
			started_at: 10,
			model_provider: null,
			model_id: null,
			eval_run_id: null,
			eval_case_id: null,
			eval_attempt: null,
			eval_suite: null,
		});
		db?.finish_run({
			id: 'run-2',
			ended_at: 11,
			success: null,
			error_message: 'telemetry disabled',
		});

		const rows = db?.read_rows<{
			success: number | null;
			error_message: string | null;
		}>("SELECT success, error_message FROM runs WHERE id = 'run-2'");
		expect(rows).toEqual([
			{
				success: null,
				error_message: 'telemetry disabled',
			},
		]);
	});

	it('fails fast on newer unsupported schema versions', async () => {
		db?.close();
		db = null;
		rmSync(TEST_DB_PATH, { force: true });

		const { DatabaseSync } = await import('node:sqlite');
		const raw_db = new DatabaseSync(TEST_DB_PATH);
		raw_db.exec('PRAGMA user_version = 999');
		raw_db.close();

		await expect(
			TelemetryDatabase.open(TEST_DB_PATH),
		).rejects.toThrow(
			'Telemetry database schema version 999 is newer than supported version 1',
		);
	});
});
