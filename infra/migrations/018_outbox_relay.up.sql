BEGIN;

ALTER TABLE domain_outbox
  ADD COLUMN next_attempt_at timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN dead_lettered_at timestamptz;

DROP INDEX domain_outbox_pending_idx;
CREATE INDEX domain_outbox_pending_idx
  ON domain_outbox (next_attempt_at, created_at)
  WHERE published_at IS NULL AND dead_lettered_at IS NULL;

COMMIT;
