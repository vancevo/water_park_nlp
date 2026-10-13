BEGIN;

DROP INDEX IF EXISTS demo_customer_tokens_created_idx;
DROP INDEX IF EXISTS payment_orders_created_cursor_idx;

COMMIT;
