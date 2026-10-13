BEGIN;

ALTER TABLE roles DROP CONSTRAINT roles_name_check;
ALTER TABLE roles ADD CONSTRAINT roles_name_check
  CHECK (name IN ('VISITOR', 'EDITOR', 'REVIEWER', 'CASHIER', 'OPERATIONS', 'ADMIN'));
INSERT INTO roles (name) VALUES ('CASHIER'), ('OPERATIONS') ON CONFLICT DO NOTHING;

ALTER TABLE users ALTER COLUMN email DROP NOT NULL;
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;
ALTER TABLE users ADD CONSTRAINT users_email_password_pair_check
  CHECK ((email IS NULL) = (password_hash IS NULL));

CREATE TABLE user_phone_identities (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  phone_lookup_hash char(64) NOT NULL UNIQUE,
  phone_last4 char(4) NOT NULL CHECK (phone_last4 ~ '^[0-9]{4}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE loyalty_accounts (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  balance integer NOT NULL DEFAULT 0 CHECK (balance >= 0),
  version integer NOT NULL DEFAULT 0 CHECK (version >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ticket_products (
  id uuid PRIMARY KEY,
  code varchar(40) NOT NULL UNIQUE,
  name varchar(120) NOT NULL,
  amount_vnd bigint NOT NULL CHECK (amount_vnd >= 0),
  points_per_item integer NOT NULL CHECK (points_per_item >= 0),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO ticket_products (id, code, name, amount_vnd, points_per_item) VALUES
  ('20000000-0000-4000-8000-000000000001', 'DEMO_ADULT', 'Vé demo người lớn', 200000, 200),
  ('20000000-0000-4000-8000-000000000002', 'DEMO_CHILD', 'Vé demo trẻ em', 120000, 120),
  ('20000000-0000-4000-8000-000000000003', 'DEMO_COMBO', 'Vé demo combo', 300000, 350);

CREATE TABLE loyalty_rules (
  id uuid PRIMARY KEY,
  ticket_product_id uuid NOT NULL REFERENCES ticket_products(id),
  version integer NOT NULL CHECK (version > 0),
  points_per_item integer NOT NULL CHECK (points_per_item >= 0),
  effective_from timestamptz NOT NULL,
  effective_until timestamptz,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (ticket_product_id, version),
  CHECK (effective_until IS NULL OR effective_until > effective_from)
);

INSERT INTO loyalty_rules (
  id, ticket_product_id, version, points_per_item, effective_from
) VALUES
  ('21000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 1, 200, '2026-01-01T00:00:00Z'),
  ('21000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 1, 120, '2026-01-01T00:00:00Z'),
  ('21000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000003', 1, 350, '2026-01-01T00:00:00Z');

CREATE TABLE demo_customer_tokens (
  token_hash char(64) PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at)
);
CREATE INDEX demo_customer_tokens_expiry_idx ON demo_customer_tokens (expires_at);

CREATE TABLE payment_orders (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  cashier_id uuid NOT NULL REFERENCES users(id),
  mode varchar(20) NOT NULL DEFAULT 'demo' CHECK (mode = 'demo'),
  status varchar(20) NOT NULL CHECK (
    status IN ('pending', 'processing', 'succeeded', 'failed', 'expired', 'cancelled')
  ),
  currency char(3) NOT NULL DEFAULT 'VND' CHECK (currency = 'VND'),
  total_amount_vnd bigint NOT NULL CHECK (total_amount_vnd >= 0),
  total_points integer NOT NULL CHECK (total_points >= 0),
  idempotency_key uuid NOT NULL,
  qr_expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  processing_at timestamptz,
  paid_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (cashier_id, idempotency_key),
  CHECK (qr_expires_at > created_at)
);
CREATE INDEX payment_orders_user_time_idx ON payment_orders (user_id, created_at DESC);
CREATE INDEX payment_orders_status_time_idx ON payment_orders (status, created_at DESC);
CREATE INDEX payment_orders_paid_time_idx ON payment_orders (paid_at DESC) WHERE paid_at IS NOT NULL;

CREATE TABLE payment_order_items (
  id uuid PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES payment_orders(id) ON DELETE CASCADE,
  ticket_product_id uuid NOT NULL REFERENCES ticket_products(id),
  product_code varchar(40) NOT NULL,
  product_name varchar(120) NOT NULL,
  quantity integer NOT NULL CHECK (quantity BETWEEN 1 AND 20),
  unit_amount_vnd bigint NOT NULL CHECK (unit_amount_vnd >= 0),
  unit_points integer NOT NULL CHECK (unit_points >= 0),
  rule_version integer NOT NULL CHECK (rule_version > 0),
  UNIQUE (order_id, ticket_product_id)
);

CREATE TABLE demo_payment_tokens (
  token_hash char(64) PRIMARY KEY,
  order_id uuid NOT NULL UNIQUE REFERENCES payment_orders(id) ON DELETE CASCADE,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at)
);
CREATE INDEX demo_payment_tokens_expiry_idx ON demo_payment_tokens (expires_at);

CREATE TABLE payment_simulation_events (
  id uuid PRIMARY KEY,
  order_id uuid NOT NULL REFERENCES payment_orders(id) ON DELETE CASCADE,
  step varchar(20) NOT NULL CHECK (step IN ('confirmed', 'processing', 'succeeded', 'failed', 'expired', 'cancelled')),
  idempotency_key uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id, idempotency_key, step)
);

CREATE TABLE loyalty_ledger_entries (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  delta integer NOT NULL CHECK (delta <> 0),
  entry_type varchar(30) NOT NULL CHECK (
    entry_type IN ('payment_credit', 'redemption_debit', 'admin_adjustment')
  ),
  source_type varchar(30) NOT NULL CHECK (source_type IN ('payment_order', 'reward_redemption', 'admin')),
  source_id uuid NOT NULL,
  description varchar(240) NOT NULL,
  idempotency_key uuid NOT NULL,
  balance_after integer NOT NULL CHECK (balance_after >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (source_type, source_id, entry_type),
  UNIQUE (user_id, idempotency_key)
);
CREATE INDEX loyalty_ledger_user_time_idx ON loyalty_ledger_entries (user_id, created_at DESC);

CREATE TABLE reward_catalog (
  id uuid PRIMARY KEY,
  code varchar(40) NOT NULL UNIQUE,
  name varchar(120) NOT NULL,
  points_cost integer NOT NULL CHECK (points_cost > 0),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO reward_catalog (id, code, name, points_cost) VALUES
  ('22000000-0000-4000-8000-000000000001', 'DEMO_DRINK', 'Nước uống demo', 100),
  ('22000000-0000-4000-8000-000000000002', 'DEMO_GIFT', 'Quà lưu niệm demo', 300);

CREATE TABLE reward_redemptions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id),
  reward_id uuid NOT NULL REFERENCES reward_catalog(id),
  reward_name varchar(120) NOT NULL,
  points_cost integer NOT NULL CHECK (points_cost > 0),
  status varchar(20) NOT NULL CHECK (status IN ('confirmed', 'fulfilled', 'cancelled')),
  fulfillment_code varchar(20) NOT NULL UNIQUE,
  idempotency_key uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, idempotency_key)
);
CREATE INDEX reward_redemptions_user_time_idx ON reward_redemptions (user_id, created_at DESC);

CREATE TABLE domain_outbox (
  id uuid PRIMARY KEY,
  event_type varchar(80) NOT NULL,
  schema_version smallint NOT NULL DEFAULT 1 CHECK (schema_version = 1),
  aggregate_id uuid NOT NULL,
  payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  retry_count integer NOT NULL DEFAULT 0 CHECK (retry_count >= 0),
  last_error_code varchar(80)
);
CREATE INDEX domain_outbox_pending_idx ON domain_outbox (created_at) WHERE published_at IS NULL;

CREATE TABLE presence_sessions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  consent_version varchar(40) NOT NULL,
  share_identity boolean NOT NULL DEFAULT false,
  pseudonym varchar(80) NOT NULL,
  avatar_variant smallint NOT NULL CHECK (avatar_variant BETWEEN 0 AND 15),
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz
);
CREATE INDEX presence_sessions_user_active_idx ON presence_sessions (user_id, started_at DESC)
  WHERE ended_at IS NULL;

CREATE TABLE presence_zone_intervals (
  zone_id varchar(80) NOT NULL,
  bucket_start timestamptz NOT NULL,
  unique_visitors integer NOT NULL CHECK (unique_visitors >= 3),
  peak_visitors integer NOT NULL CHECK (peak_visitors >= unique_visitors),
  PRIMARY KEY (zone_id, bucket_start)
);

COMMIT;
