CREATE TABLE IF NOT EXISTS session_runtimes (
	session_id TEXT PRIMARY KEY,
	runtime_id TEXT NOT NULL UNIQUE,
	generation INTEGER NOT NULL DEFAULT 1 CHECK (generation > 0),
	pid INTEGER,
	process_identity_json TEXT,
	endpoint TEXT,
	state TEXT NOT NULL CHECK (state IN ('created', 'starting', 'ready', 'idle', 'running', 'waiting', 'blocked', 'stopping', 'offline', 'failed')),
	autonomous INTEGER NOT NULL DEFAULT 1 CHECK (autonomous IN (0, 1)),
	control_owner TEXT,
	heartbeat_at TEXT,
	lease_expires_at TEXT NOT NULL,
	ready_at TEXT,
	stopped_at TEXT,
	exit_code INTEGER,
	exit_signal TEXT,
	error TEXT,
	diagnostics_json TEXT NOT NULL DEFAULT '[]',
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS runtime_events (
	event_id TEXT PRIMARY KEY,
	session_id TEXT NOT NULL,
	runtime_id TEXT NOT NULL,
	generation INTEGER NOT NULL,
	state TEXT NOT NULL CHECK (state IN ('created', 'starting', 'ready', 'idle', 'running', 'waiting', 'blocked', 'stopping', 'offline', 'failed')),
	created_at TEXT NOT NULL,
	diagnostics_json TEXT NOT NULL DEFAULT '[]',
	data_json TEXT NOT NULL DEFAULT '{}',
	FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_session_runtimes_state ON session_runtimes(state, lease_expires_at);
CREATE INDEX IF NOT EXISTS idx_runtime_events_session ON runtime_events(session_id, created_at);
