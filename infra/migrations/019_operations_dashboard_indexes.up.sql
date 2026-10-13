BEGIN;

CREATE INDEX payment_orders_created_cursor_idx
  ON payment_orders (created_at DESC, id DESC);

CREATE INDEX demo_customer_tokens_created_idx
  ON demo_customer_tokens (created_at DESC);

COMMIT;
