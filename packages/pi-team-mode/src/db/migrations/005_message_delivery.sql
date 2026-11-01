UPDATE message_receipts
SET delivered_at = COALESCE(delivered_at, read_at, acknowledged_at),
    read_at = COALESCE(read_at, acknowledged_at)
WHERE read_at IS NOT NULL OR acknowledged_at IS NOT NULL;

ALTER TABLE messages ADD COLUMN message_type TEXT NOT NULL DEFAULT 'action'
  CHECK (message_type IN ('action', 'status'));
ALTER TABLE messages ADD COLUMN status_key TEXT;
ALTER TABLE messages ADD COLUMN idempotency_key TEXT;
ALTER TABLE messages ADD COLUMN request_hash TEXT;
CREATE UNIQUE INDEX messages_sender_idempotency
  ON messages (from_session_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
