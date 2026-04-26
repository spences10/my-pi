import {
	existsSync,
	mkdirSync,
	readFileSync,
	statSync,
} from 'node:fs';
import { dirname } from 'node:path';

import type { DatabaseSync, StatementSync } from 'node:sqlite';

const SCHEMA = readFileSync(
	new URL('./schema.sql', import.meta.url),
	'utf-8',
);
const LATEST_TELEMETRY_SCHEMA_VERSION = 1;
const PERSISTENT_PRAGMAS = `
PRAGMA journal_mode = WAL;
`;
const CONNECTION_PRAGMAS = `
PRAGMA foreign_keys = ON;
PRAGMA busy_timeout = 5000;
`;
const MIGRATIONS: Record<number, string> = {
	1: SCHEMA,
};

type DatabaseSyncConstructor =
	typeof import('node:sqlite').DatabaseSync;

function get_file_size(path: string): number {
	return existsSync(path) ? statSync(path).size : 0;
}

export interface TelemetryRunRecord {
	id: string;
	session_file: string | null;
	cwd: string;
	started_at: number;
	model_provider: string | null;
	model_id: string | null;
	eval_run_id: string | null;
	eval_case_id: string | null;
	eval_attempt: number | null;
	eval_suite: string | null;
}

export interface TelemetryRunFinish {
	id: string;
	ended_at: number;
	success: boolean | null;
	error_message: string | null;
}

export interface TelemetryTurnRecord {
	id: string;
	run_id: string;
	turn_index: number;
	started_at: number;
}

export interface TelemetryTurnFinish {
	id: string;
	ended_at: number;
	tool_result_count: number;
	stop_reason: string | null;
}

export interface TelemetryToolCallRecord {
	tool_call_id: string;
	run_id: string;
	turn_id: string | null;
	tool_name: string;
	started_at: number;
	args_summary_json: string | null;
}

export interface TelemetryToolCallFinish {
	tool_call_id: string;
	ended_at: number;
	is_error: boolean;
	result_summary_json: string | null;
	error_message: string | null;
}

export interface TelemetryProviderRequestRecord {
	id: string;
	run_id: string;
	turn_id: string | null;
	started_at: number;
	payload_summary_json: string | null;
}

export interface TelemetryProviderRequestFinish {
	id: string;
	ended_at: number;
	status_code: number;
	headers_json: string | null;
}

export interface TelemetryStats {
	runs: number;
	turns: number;
	tool_calls: number;
	provider_requests: number;
	schema_version: number;
	db_bytes: number;
	wal_bytes: number;
	total_bytes: number;
}

export interface TelemetryQueryFilters {
	eval_run_id?: string;
	eval_case_id?: string;
	eval_suite?: string;
	success?: boolean | null;
	limit?: number;
}

export interface TelemetryRunSummary {
	id: string;
	session_file: string | null;
	cwd: string;
	started_at: number;
	ended_at: number | null;
	duration_ms: number | null;
	model_provider: string | null;
	model_id: string | null;
	eval_run_id: string | null;
	eval_case_id: string | null;
	eval_attempt: number | null;
	eval_suite: string | null;
	success: boolean | null;
	error_message: string | null;
	turn_count: number;
	tool_call_count: number;
	tool_error_count: number;
	provider_request_count: number;
}

export class TelemetryDatabase {
	private db: DatabaseSync;
	private db_path: string;
	private stmt_insert_run: StatementSync;
	private stmt_finish_run: StatementSync;
	private stmt_insert_turn: StatementSync;
	private stmt_finish_turn: StatementSync;
	private stmt_insert_tool_call: StatementSync;
	private stmt_tool_call_update: StatementSync;
	private stmt_finish_tool_call: StatementSync;
	private stmt_insert_provider_request: StatementSync;
	private stmt_finish_provider_request: StatementSync;

	static async open(db_path: string): Promise<TelemetryDatabase> {
		const sqlite = await import('node:sqlite');
		return new TelemetryDatabase(sqlite.DatabaseSync, db_path);
	}

	constructor(
		DatabaseSyncCtor: DatabaseSyncConstructor,
		db_path: string,
	) {
		const dir = dirname(db_path);
		if (!existsSync(dir)) {
			mkdirSync(dir, { recursive: true, mode: 0o700 });
		}

		this.db_path = db_path;
		this.db = new DatabaseSyncCtor(db_path, {
			enableForeignKeyConstraints: true,
		});
		this.db.exec(PERSISTENT_PRAGMAS);
		this.db.exec(CONNECTION_PRAGMAS);
		this.apply_migrations();

		this.stmt_insert_run = this.db.prepare(`
			INSERT INTO runs (
				id,
				session_file,
				cwd,
				started_at,
				model_provider,
				model_id,
				eval_run_id,
				eval_case_id,
				eval_attempt,
				eval_suite
			) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
		`);
		this.stmt_finish_run = this.db.prepare(`
			UPDATE runs
			SET ended_at = ?, success = ?, error_message = ?
			WHERE id = ?
		`);
		this.stmt_insert_turn = this.db.prepare(`
			INSERT INTO turns (id, run_id, turn_index, started_at)
			VALUES (?, ?, ?, ?)
		`);
		this.stmt_finish_turn = this.db.prepare(`
			UPDATE turns
			SET ended_at = ?, tool_result_count = ?, stop_reason = ?
			WHERE id = ?
		`);
		this.stmt_insert_tool_call = this.db.prepare(`
			INSERT INTO tool_calls (
				tool_call_id,
				run_id,
				turn_id,
				tool_name,
				started_at,
				args_summary_json
			) VALUES (?, ?, ?, ?, ?, ?)
		`);
		this.stmt_tool_call_update = this.db.prepare(`
			UPDATE tool_calls
			SET partial_update_count = partial_update_count + 1
			WHERE tool_call_id = ?
		`);
		this.stmt_finish_tool_call = this.db.prepare(`
			UPDATE tool_calls
			SET ended_at = ?, is_error = ?, result_summary_json = ?, error_message = ?
			WHERE tool_call_id = ?
		`);
		this.stmt_insert_provider_request = this.db.prepare(`
			INSERT INTO provider_requests (
				id,
				run_id,
				turn_id,
				started_at,
				payload_summary_json
			) VALUES (?, ?, ?, ?, ?)
		`);
		this.stmt_finish_provider_request = this.db.prepare(`
			UPDATE provider_requests
			SET ended_at = ?, status_code = ?, headers_json = ?
			WHERE id = ?
		`);
	}

	insert_run(record: TelemetryRunRecord): void {
		this.stmt_insert_run.run(
			record.id,
			record.session_file,
			record.cwd,
			record.started_at,
			record.model_provider,
			record.model_id,
			record.eval_run_id,
			record.eval_case_id,
			record.eval_attempt,
			record.eval_suite,
		);
	}

	finish_run(record: TelemetryRunFinish): void {
		this.stmt_finish_run.run(
			record.ended_at,
			record.success === null ? null : record.success ? 1 : 0,
			record.error_message,
			record.id,
		);
	}

	insert_turn(record: TelemetryTurnRecord): void {
		this.stmt_insert_turn.run(
			record.id,
			record.run_id,
			record.turn_index,
			record.started_at,
		);
	}

	finish_turn(record: TelemetryTurnFinish): void {
		this.stmt_finish_turn.run(
			record.ended_at,
			record.tool_result_count,
			record.stop_reason,
			record.id,
		);
	}

	insert_tool_call(record: TelemetryToolCallRecord): void {
		this.stmt_insert_tool_call.run(
			record.tool_call_id,
			record.run_id,
			record.turn_id,
			record.tool_name,
			record.started_at,
			record.args_summary_json,
		);
	}

	note_tool_update(tool_call_id: string): void {
		this.stmt_tool_call_update.run(tool_call_id);
	}

	finish_tool_call(record: TelemetryToolCallFinish): void {
		this.stmt_finish_tool_call.run(
			record.ended_at,
			record.is_error ? 1 : 0,
			record.result_summary_json,
			record.error_message,
			record.tool_call_id,
		);
	}

	insert_provider_request(
		record: TelemetryProviderRequestRecord,
	): void {
		this.stmt_insert_provider_request.run(
			record.id,
			record.run_id,
			record.turn_id,
			record.started_at,
			record.payload_summary_json,
		);
	}

	finish_provider_request(
		record: TelemetryProviderRequestFinish,
	): void {
		this.stmt_finish_provider_request.run(
			record.ended_at,
			record.status_code,
			record.headers_json,
			record.id,
		);
	}

	private get_user_version(): number {
		const row = this.db.prepare('PRAGMA user_version').get() as {
			user_version: number;
		};
		return row.user_version;
	}

	private apply_migrations(): void {
		const current_version = this.get_user_version();
		if (current_version > LATEST_TELEMETRY_SCHEMA_VERSION) {
			this.db.close();
			throw new Error(
				`Telemetry database schema version ${current_version} is newer than supported version ${LATEST_TELEMETRY_SCHEMA_VERSION}`,
			);
		}

		for (
			let next_version = current_version + 1;
			next_version <= LATEST_TELEMETRY_SCHEMA_VERSION;
			next_version++
		) {
			const migration = MIGRATIONS[next_version];
			if (!migration) {
				this.db.close();
				throw new Error(
					`Missing telemetry migration for schema version ${next_version}`,
				);
			}

			this.db.exec('BEGIN');
			try {
				this.db.exec(migration);
				this.db.exec(`PRAGMA user_version = ${next_version}`);
				this.db.exec('COMMIT');
			} catch (error) {
				this.db.exec('ROLLBACK');
				this.db.close();
				throw error;
			}
		}
	}

	query_runs(
		filters: TelemetryQueryFilters = {},
	): TelemetryRunSummary[] {
		const conditions: string[] = [];
		const params: Array<string | number> = [];

		if (filters.eval_run_id !== undefined) {
			conditions.push('r.eval_run_id = ?');
			params.push(filters.eval_run_id);
		}
		if (filters.eval_case_id !== undefined) {
			conditions.push('r.eval_case_id = ?');
			params.push(filters.eval_case_id);
		}
		if (filters.eval_suite !== undefined) {
			conditions.push('r.eval_suite = ?');
			params.push(filters.eval_suite);
		}
		if (filters.success === null) {
			conditions.push('r.success IS NULL');
		} else if (filters.success !== undefined) {
			conditions.push('r.success = ?');
			params.push(filters.success ? 1 : 0);
		}

		const where_clause =
			conditions.length > 0
				? `WHERE ${conditions.join(' AND ')}`
				: '';
		const limit_clause =
			typeof filters.limit === 'number' && filters.limit > 0
				? 'LIMIT ?'
				: '';
		if (limit_clause) {
			params.push(filters.limit!);
		}

		const rows = this.db
			.prepare(
				`
				SELECT
					r.id,
					r.session_file,
					r.cwd,
					r.started_at,
					r.ended_at,
					CASE
						WHEN r.ended_at IS NOT NULL
						THEN r.ended_at - r.started_at
						ELSE NULL
					END AS duration_ms,
					r.model_provider,
					r.model_id,
					r.eval_run_id,
					r.eval_case_id,
					r.eval_attempt,
					r.eval_suite,
					r.success,
					r.error_message,
					COUNT(DISTINCT t.id) AS turn_count,
					COUNT(DISTINCT tc.tool_call_id) AS tool_call_count,
					COUNT(DISTINCT CASE
						WHEN tc.is_error = 1 THEN tc.tool_call_id
					END) AS tool_error_count,
					COUNT(DISTINCT pr.id) AS provider_request_count
				FROM runs r
				LEFT JOIN turns t ON t.run_id = r.id
				LEFT JOIN tool_calls tc ON tc.run_id = r.id
				LEFT JOIN provider_requests pr ON pr.run_id = r.id
				${where_clause}
				GROUP BY r.id
				ORDER BY r.started_at DESC
				${limit_clause}
				`,
			)
			.all(...params) as Array<{
			id: string;
			session_file: string | null;
			cwd: string;
			started_at: number;
			ended_at: number | null;
			duration_ms: number | null;
			model_provider: string | null;
			model_id: string | null;
			eval_run_id: string | null;
			eval_case_id: string | null;
			eval_attempt: number | null;
			eval_suite: string | null;
			success: number | null;
			error_message: string | null;
			turn_count: number;
			tool_call_count: number;
			tool_error_count: number;
			provider_request_count: number;
		}>;

		return rows.map((row) => ({
			...row,
			success: row.success === null ? null : row.success === 1,
		}));
	}

	get_stats(): TelemetryStats {
		const runs = this.db
			.prepare('SELECT COUNT(*) as count FROM runs')
			.get() as {
			count: number;
		};
		const turns = this.db
			.prepare('SELECT COUNT(*) as count FROM turns')
			.get() as {
			count: number;
		};
		const tool_calls = this.db
			.prepare('SELECT COUNT(*) as count FROM tool_calls')
			.get() as { count: number };
		const provider_requests = this.db
			.prepare('SELECT COUNT(*) as count FROM provider_requests')
			.get() as { count: number };

		const db_bytes = get_file_size(this.db_path);
		const wal_bytes = get_file_size(`${this.db_path}-wal`);

		return {
			runs: runs.count,
			turns: turns.count,
			tool_calls: tool_calls.count,
			provider_requests: provider_requests.count,
			schema_version: this.get_user_version(),
			db_bytes,
			wal_bytes,
			total_bytes: db_bytes + wal_bytes,
		};
	}

	read_rows<T extends Record<string, unknown>>(query: string): T[] {
		return this.db.prepare(query).all() as T[];
	}

	close(): void {
		this.db.close();
	}
}
