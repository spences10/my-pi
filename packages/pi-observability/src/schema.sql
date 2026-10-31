-- Source of truth for local observability SQLite DDL.
-- This file is the schema for observability database version 2.
-- Database setup pragmas and migrations are applied in code (db.ts).


CREATE TABLE IF NOT EXISTS sessions (
	session_id TEXT PRIMARY KEY,
	pool TEXT NOT NULL DEFAULT 'default',
	agent_name TEXT,
	session_name TEXT,
	cwd TEXT,
	session_file TEXT,
	provider TEXT,
	model TEXT,
	first_ts TEXT NOT NULL,
	last_ts TEXT NOT NULL,
	event_count INTEGER NOT NULL DEFAULT 0,
	tags_json TEXT NOT NULL DEFAULT '[]'
);
CREATE TABLE IF NOT EXISTS events (
	event_id TEXT PRIMARY KEY,
	session_id TEXT NOT NULL,
	seq INTEGER NOT NULL,
	ts TEXT NOT NULL,
	type TEXT NOT NULL,
	pool TEXT NOT NULL DEFAULT 'default',
	tags_json TEXT NOT NULL DEFAULT '[]',
	payload_json TEXT NOT NULL,
	provider TEXT,
	model TEXT,
	-- Columns derived from payload_json at ingest (event-columns.ts).
	turn_index INTEGER,
	tool_call_id TEXT,
	tool_name TEXT,
	is_error INTEGER,
	duration_ms REAL,
	stop_reason TEXT,
	input_tokens INTEGER,
	output_tokens INTEGER,
	cache_read_tokens INTEGER,
	cache_write_tokens INTEGER,
	cost_usd REAL,
	error_text TEXT,
	exit_code INTEGER,
	parent_tool_call_id TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_session_seq ON events(session_id, seq);
CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts);
CREATE INDEX IF NOT EXISTS idx_events_pool ON events(pool);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
CREATE INDEX IF NOT EXISTS idx_events_session_tool_call
	ON events(session_id, tool_call_id) WHERE tool_call_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_events_tool_name
	ON events(tool_name) WHERE tool_name IS NOT NULL;

-- Views are dropped and recreated on every start, so changing one
-- needs no migration.

-- One row per tool execution. duration_ms prefers Pi's monotonic
-- durationMs and falls back to the event timestamp difference.
DROP VIEW IF EXISTS tool_spans;
CREATE VIEW tool_spans AS
SELECT
	s.session_id,
	s.tool_call_id,
	s.tool_name,
	s.ts AS start_ts,
	e.ts AS end_ts,
	COALESCE(
		e.duration_ms,
		(unixepoch(e.ts, 'subsec') - unixepoch(s.ts, 'subsec')) * 1000.0
	) AS duration_ms,
	e.is_error,
	json_extract(e.payload_json, '$.updateCount') AS update_count,
	e.error_text,
	e.exit_code,
	s.parent_tool_call_id
FROM events s
LEFT JOIN events e
	ON e.session_id = s.session_id
	AND e.tool_call_id = s.tool_call_id
	AND e.type = 'tool_execution_end'
WHERE s.type = 'tool_execution_start';

-- One row per agent turn, with usage from the message_end events and
-- tool time from the tool_execution_end events inside the turn.
-- provider_ms is the sum of assistant message durationMs values.
-- Pi restarts turnIndex for each prompt, so a turn_start is paired
-- with the next turn_end by seq; start_seq identifies the turn.
DROP VIEW IF EXISTS turn_spans;
CREATE VIEW turn_spans AS
SELECT
	s.session_id,
	s.seq AS start_seq,
	s.turn_index,
	s.ts AS start_ts,
	e.ts AS end_ts,
	(unixepoch(e.ts, 'subsec') - unixepoch(s.ts, 'subsec')) * 1000.0 AS duration_ms,
	e.stop_reason,
	SUM(CASE WHEN m.type = 'message_end' THEN m.duration_ms END) AS provider_ms,
	SUM(CASE WHEN m.type = 'tool_execution_end' THEN m.duration_ms END) AS tool_ms,
	SUM(m.type = 'tool_execution_end') AS tool_calls,
	SUM(m.type = 'tool_execution_end' AND m.is_error = 1) AS tool_errors,
	SUM(m.input_tokens) AS input_tokens,
	SUM(m.output_tokens) AS output_tokens,
	SUM(m.cache_read_tokens) AS cache_read_tokens,
	SUM(m.cache_write_tokens) AS cache_write_tokens,
	SUM(m.cost_usd) AS cost_usd
FROM events s
JOIN events e
	ON e.session_id = s.session_id
	AND e.seq = (
		SELECT MIN(x.seq) FROM events x
		WHERE x.session_id = s.session_id
			AND x.seq > s.seq
			AND x.type = 'turn_end'
	)
LEFT JOIN events m
	ON m.session_id = s.session_id
	AND m.seq > s.seq
	AND m.seq < e.seq
	AND m.type IN ('message_end', 'tool_execution_end')
WHERE s.type = 'turn_start'
GROUP BY s.event_id;
