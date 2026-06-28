-- Source of truth for local team-mode coordination SQLite DDL.
-- This file is the schema for coordination database version 1.
-- Database setup pragmas and migration versioning are applied in code.

CREATE TABLE IF NOT EXISTS sessions (
	session_id TEXT PRIMARY KEY,
	session_file TEXT,
	cwd TEXT NOT NULL,
	agent_name TEXT,
	pid INTEGER,
	role TEXT NOT NULL DEFAULT 'peer' CHECK (role IN ('peer', 'lead', 'teammate')),
	status TEXT NOT NULL DEFAULT 'online' CHECK (status IN ('online', 'idle', 'running', 'blocked', 'offline')),
	model_provider TEXT,
	model_id TEXT,
	pool TEXT NOT NULL DEFAULT 'default',
	tags_json TEXT NOT NULL DEFAULT '[]',
	metadata_json TEXT NOT NULL DEFAULT '{}',
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	last_seen_at TEXT NOT NULL,
	offline_at TEXT
);

CREATE TABLE IF NOT EXISTS groups (
	group_id TEXT PRIMARY KEY,
	name TEXT NOT NULL,
	cwd TEXT,
	created_by_session_id TEXT,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	next_task_id INTEGER NOT NULL DEFAULT 1,
	metadata_json TEXT NOT NULL DEFAULT '{}',
	FOREIGN KEY (created_by_session_id) REFERENCES sessions(session_id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_groups_name_cwd ON groups(name, cwd);

CREATE TABLE IF NOT EXISTS group_members (
	group_id TEXT NOT NULL,
	session_id TEXT NOT NULL,
	alias TEXT,
	role TEXT NOT NULL DEFAULT 'peer' CHECK (role IN ('lead', 'teammate', 'peer', 'reviewer')),
	status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
	joined_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	PRIMARY KEY (group_id, session_id),
	FOREIGN KEY (group_id) REFERENCES groups(group_id) ON DELETE CASCADE,
	FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_group_members_alias ON group_members(group_id, alias) WHERE alias IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_group_members_session ON group_members(session_id);

CREATE TABLE IF NOT EXISTS messages (
	message_id TEXT PRIMARY KEY,
	from_session_id TEXT NOT NULL,
	scope TEXT NOT NULL CHECK (scope IN ('session', 'group', 'broadcast')),
	target TEXT NOT NULL,
	body TEXT NOT NULL,
	urgent INTEGER NOT NULL DEFAULT 0 CHECK (urgent IN (0, 1)),
	reply_to TEXT,
	expires_at TEXT,
	requires_ack INTEGER NOT NULL DEFAULT 0 CHECK (requires_ack IN (0, 1)),
	created_at TEXT NOT NULL,
	metadata_json TEXT NOT NULL DEFAULT '{}',
	FOREIGN KEY (from_session_id) REFERENCES sessions(session_id) ON DELETE CASCADE,
	FOREIGN KEY (reply_to) REFERENCES messages(message_id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS message_receipts (
	message_id TEXT NOT NULL,
	to_session_id TEXT NOT NULL,
	delivered_at TEXT,
	read_at TEXT,
	acknowledged_at TEXT,
	created_at TEXT NOT NULL,
	PRIMARY KEY (message_id, to_session_id),
	FOREIGN KEY (message_id) REFERENCES messages(message_id) ON DELETE CASCADE,
	FOREIGN KEY (to_session_id) REFERENCES sessions(session_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS tasks (
	group_id TEXT NOT NULL,
	task_id TEXT NOT NULL,
	title TEXT NOT NULL,
	description TEXT,
	status TEXT NOT NULL CHECK (status IN ('pending', 'in_progress', 'blocked', 'completed', 'cancelled')),
	assignee_session_id TEXT,
	assignee_alias TEXT,
	result TEXT,
	created_by_session_id TEXT,
	created_at TEXT NOT NULL,
	updated_at TEXT NOT NULL,
	completed_at TEXT,
	PRIMARY KEY (group_id, task_id),
	FOREIGN KEY (group_id) REFERENCES groups(group_id) ON DELETE CASCADE,
	FOREIGN KEY (assignee_session_id) REFERENCES sessions(session_id) ON DELETE SET NULL,
	FOREIGN KEY (created_by_session_id) REFERENCES sessions(session_id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS task_dependencies (
	group_id TEXT NOT NULL,
	task_id TEXT NOT NULL,
	depends_on_task_id TEXT NOT NULL,
	PRIMARY KEY (group_id, task_id, depends_on_task_id),
	FOREIGN KEY (group_id, task_id) REFERENCES tasks(group_id, task_id) ON DELETE CASCADE,
	FOREIGN KEY (group_id, depends_on_task_id) REFERENCES tasks(group_id, task_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS events (
	event_id TEXT PRIMARY KEY,
	type TEXT NOT NULL,
	session_id TEXT,
	group_id TEXT,
	message_id TEXT,
	created_at TEXT NOT NULL,
	data_json TEXT NOT NULL DEFAULT '{}',
	FOREIGN KEY (session_id) REFERENCES sessions(session_id) ON DELETE SET NULL,
	FOREIGN KEY (group_id) REFERENCES groups(group_id) ON DELETE SET NULL,
	FOREIGN KEY (message_id) REFERENCES messages(message_id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_sessions_last_seen ON sessions(last_seen_at);
CREATE INDEX IF NOT EXISTS idx_sessions_cwd ON sessions(cwd);
CREATE INDEX IF NOT EXISTS idx_sessions_agent_name ON sessions(agent_name);
CREATE INDEX IF NOT EXISTS idx_sessions_pool ON sessions(pool);
CREATE INDEX IF NOT EXISTS idx_messages_from ON messages(from_session_id);
CREATE INDEX IF NOT EXISTS idx_messages_created ON messages(created_at);
CREATE INDEX IF NOT EXISTS idx_message_receipts_to_pending ON message_receipts(to_session_id, delivered_at, read_at, acknowledged_at);
CREATE INDEX IF NOT EXISTS idx_tasks_group_status ON tasks(group_id, status);
CREATE INDEX IF NOT EXISTS idx_tasks_assignee_session ON tasks(assignee_session_id);
CREATE INDEX IF NOT EXISTS idx_events_created ON events(created_at);
