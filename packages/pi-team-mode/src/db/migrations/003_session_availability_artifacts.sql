ALTER TABLE sessions ADD COLUMN availability TEXT NOT NULL DEFAULT 'available' CHECK (availability IN ('available', 'busy', 'standby', 'handoff', 'offline'));
ALTER TABLE sessions ADD COLUMN intent TEXT;
ALTER TABLE sessions ADD COLUMN session_alias TEXT;
ALTER TABLE sessions ADD COLUMN parent_session_id TEXT;
CREATE INDEX IF NOT EXISTS idx_sessions_availability ON sessions(availability);
CREATE INDEX IF NOT EXISTS idx_sessions_intent ON sessions(intent);
CREATE INDEX IF NOT EXISTS idx_sessions_session_alias ON sessions(session_alias);
CREATE TABLE IF NOT EXISTS coordination_artifacts (
	artifact_id TEXT PRIMARY KEY,
	kind TEXT NOT NULL CHECK (kind IN ('summary', 'handoff', 'plan', 'evidence', 'result', 'log', 'diff')),
	owner_session_id TEXT NOT NULL,
	cwd TEXT NOT NULL,
	title TEXT NOT NULL,
	summary TEXT NOT NULL,
	body TEXT NOT NULL,
	body_format TEXT NOT NULL DEFAULT 'markdown',
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	metadata_json TEXT NOT NULL DEFAULT '{}',
	FOREIGN KEY (owner_session_id) REFERENCES sessions(session_id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_coordination_artifacts_owner ON coordination_artifacts(owner_session_id);
CREATE INDEX IF NOT EXISTS idx_coordination_artifacts_cwd_kind ON coordination_artifacts(cwd, kind);
CREATE INDEX IF NOT EXISTS idx_coordination_artifacts_updated ON coordination_artifacts(updated_at);
