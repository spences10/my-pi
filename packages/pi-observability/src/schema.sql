-- Source of truth for local observability SQLite DDL.
-- Database setup pragmas are applied in code.


CREATE TABLE IF NOT EXISTS sessions (
	session_id TEXT PRIMARY KEY,
	pool TEXT NOT NULL DEFAULT 'default',
	agent_name TEXT,
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
	model TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_events_session_seq ON events(session_id, seq);
CREATE INDEX IF NOT EXISTS idx_events_ts ON events(ts);
CREATE INDEX IF NOT EXISTS idx_events_pool ON events(pool);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(type);
