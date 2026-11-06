-- Mailbox storage and permission to interrupt are independent.
ALTER TABLE groups ADD COLUMN closed_at TEXT;
ALTER TABLE message_receipts ADD COLUMN auto_delivery INTEGER NOT NULL DEFAULT 0 CHECK (auto_delivery IN (0, 1));
ALTER TABLE message_receipts ADD COLUMN collaboration_id TEXT REFERENCES groups(group_id) ON DELETE SET NULL;

CREATE TABLE delivery_controls (
 session_id TEXT NOT NULL REFERENCES sessions(session_id) ON DELETE CASCADE,
 scope TEXT NOT NULL CHECK (scope IN ('session', 'sender', 'group')),
 target TEXT NOT NULL,
 paused INTEGER NOT NULL CHECK (paused IN (0, 1)),
 updated_at TEXT NOT NULL,
 PRIMARY KEY (session_id, scope, target)
);

-- Existing pending mail stays available for explicit retrieval. Do not wake
-- reopened conversations merely because an old database was upgraded.
