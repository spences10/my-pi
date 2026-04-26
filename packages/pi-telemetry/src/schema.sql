-- Source of truth for local telemetry SQLite DDL.
-- This file is the schema for telemetry database version 1.
-- Database setup pragmas and migration versioning are applied in code.

CREATE TABLE IF NOT EXISTS runs (
	id TEXT PRIMARY KEY,
	session_file TEXT,
	cwd TEXT NOT NULL,
	started_at INTEGER NOT NULL,
	ended_at INTEGER,
	model_provider TEXT,
	model_id TEXT,
	eval_run_id TEXT,
	eval_case_id TEXT,
	eval_attempt INTEGER,
	eval_suite TEXT,
	success INTEGER,
	error_message TEXT
);

CREATE TABLE IF NOT EXISTS turns (
	id TEXT PRIMARY KEY,
	run_id TEXT NOT NULL,
	turn_index INTEGER NOT NULL,
	started_at INTEGER NOT NULL,
	ended_at INTEGER,
	tool_result_count INTEGER,
	stop_reason TEXT,
	FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tool_calls (
	tool_call_id TEXT PRIMARY KEY,
	run_id TEXT NOT NULL,
	turn_id TEXT,
	tool_name TEXT NOT NULL,
	started_at INTEGER NOT NULL,
	ended_at INTEGER,
	is_error INTEGER,
	args_summary_json TEXT,
	partial_update_count INTEGER NOT NULL DEFAULT 0,
	result_summary_json TEXT,
	error_message TEXT,
	FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE,
	FOREIGN KEY (turn_id) REFERENCES turns(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS provider_requests (
	id TEXT PRIMARY KEY,
	run_id TEXT NOT NULL,
	turn_id TEXT,
	started_at INTEGER NOT NULL,
	ended_at INTEGER,
	status_code INTEGER,
	payload_summary_json TEXT,
	headers_json TEXT,
	FOREIGN KEY (run_id) REFERENCES runs(id) ON DELETE CASCADE,
	FOREIGN KEY (turn_id) REFERENCES turns(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_runs_started_at ON runs(started_at);
CREATE INDEX IF NOT EXISTS idx_runs_eval_run_id ON runs(eval_run_id);
CREATE INDEX IF NOT EXISTS idx_runs_eval_case_id ON runs(eval_case_id);
CREATE INDEX IF NOT EXISTS idx_turns_run_id ON turns(run_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_turns_run_turn_index ON turns(run_id, turn_index);
CREATE INDEX IF NOT EXISTS idx_tool_calls_run_id ON tool_calls(run_id);
CREATE INDEX IF NOT EXISTS idx_tool_calls_tool_name ON tool_calls(tool_name);
CREATE INDEX IF NOT EXISTS idx_provider_requests_run_id ON provider_requests(run_id);
