BEGIN;

DROP TABLE IF EXISTS presence_zone_intervals;
DROP TABLE IF EXISTS presence_sessions;
DROP TABLE IF EXISTS domain_outbox;
DROP TABLE IF EXISTS reward_redemptions;
DROP TABLE IF EXISTS reward_catalog;
DROP TABLE IF EXISTS loyalty_ledger_entries;
DROP TABLE IF EXISTS payment_simulation_events;
DROP TABLE IF EXISTS demo_payment_tokens;
DROP TABLE IF EXISTS payment_order_items;
DROP TABLE IF EXISTS payment_orders;
DROP TABLE IF EXISTS demo_customer_tokens;
DROP TABLE IF EXISTS loyalty_rules;
DROP TABLE IF EXISTS ticket_products;
DROP TABLE IF EXISTS loyalty_accounts;
DROP TABLE IF EXISTS user_phone_identities;

DELETE FROM user_roles WHERE role_name IN ('CASHIER', 'OPERATIONS');
DELETE FROM roles WHERE name IN ('CASHIER', 'OPERATIONS');
DELETE FROM users WHERE email IS NULL;

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_email_password_pair_check;
ALTER TABLE users ALTER COLUMN email SET NOT NULL;
ALTER TABLE users ALTER COLUMN password_hash SET NOT NULL;

ALTER TABLE roles DROP CONSTRAINT roles_name_check;
ALTER TABLE roles ADD CONSTRAINT roles_name_check
  CHECK (name IN ('VISITOR', 'EDITOR', 'REVIEWER', 'ADMIN'));

COMMIT;
