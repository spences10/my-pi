CREATE TABLE IF NOT EXISTS context_sources (
  id TEXT PRIMARY KEY,
  session_id TEXT,
  project_path TEXT,
  tool_name TEXT NOT NULL,
  input_summary TEXT,
  created_at INTEGER NOT NULL,
  byte_count INTEGER NOT NULL,
  line_count INTEGER NOT NULL,
  content_hash TEXT NOT NULL,
  preview_byte_count INTEGER NOT NULL DEFAULT 0,
  returned_byte_count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS context_chunks (
  id TEXT PRIMARY KEY,
  source_id TEXT NOT NULL REFERENCES context_sources(id) ON DELETE CASCADE,
  ordinal INTEGER NOT NULL,
  title TEXT,
  content TEXT NOT NULL,
  byte_count INTEGER NOT NULL
);

CREATE VIRTUAL TABLE IF NOT EXISTS context_chunks_fts USING fts5(
  title,
  content,
  content='context_chunks',
  content_rowid='rowid'
);

CREATE TRIGGER IF NOT EXISTS context_chunks_ai AFTER INSERT ON context_chunks BEGIN
  INSERT INTO context_chunks_fts(rowid, title, content) VALUES (new.rowid, new.title, new.content);
END;

CREATE TRIGGER IF NOT EXISTS context_chunks_ad AFTER DELETE ON context_chunks BEGIN
  INSERT INTO context_chunks_fts(context_chunks_fts, rowid, title, content)
  VALUES('delete', old.rowid, old.title, old.content);
END;

CREATE TRIGGER IF NOT EXISTS context_chunks_au AFTER UPDATE ON context_chunks BEGIN
  INSERT INTO context_chunks_fts(context_chunks_fts, rowid, title, content)
  VALUES('delete', old.rowid, old.title, old.content);
  INSERT INTO context_chunks_fts(rowid, title, content) VALUES (new.rowid, new.title, new.content);
END;

CREATE INDEX IF NOT EXISTS idx_context_sources_created ON context_sources(created_at);
CREATE INDEX IF NOT EXISTS idx_context_sources_session ON context_sources(session_id);
CREATE INDEX IF NOT EXISTS idx_context_sources_project ON context_sources(project_path);
CREATE INDEX IF NOT EXISTS idx_context_chunks_source ON context_chunks(source_id, ordinal);
