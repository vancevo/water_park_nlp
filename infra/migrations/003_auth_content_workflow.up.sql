BEGIN;

CREATE TABLE users (
  id uuid PRIMARY KEY,
  email varchar(320) NOT NULL,
  password_hash text NOT NULL,
  status varchar(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  preferred_locale varchar(5) NOT NULL DEFAULT 'vi' CHECK (preferred_locale IN ('vi', 'en')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_normalized_email_idx ON users (lower(email));

CREATE TABLE roles (
  name varchar(20) PRIMARY KEY CHECK (name IN ('VISITOR', 'EDITOR', 'REVIEWER', 'ADMIN'))
);
INSERT INTO roles (name) VALUES ('VISITOR'), ('EDITOR'), ('REVIEWER'), ('ADMIN');

CREATE TABLE user_roles (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role_name varchar(20) NOT NULL REFERENCES roles(name),
  PRIMARY KEY (user_id, role_name)
);

CREATE TABLE refresh_tokens (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash char(64) NOT NULL,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX refresh_tokens_user_active_idx ON refresh_tokens (user_id, expires_at)
  WHERE revoked_at IS NULL;

CREATE TABLE poi_content_versions (
  id uuid PRIMARY KEY,
  poi_id uuid NOT NULL REFERENCES pois(id) ON DELETE CASCADE,
  version integer NOT NULL CHECK (version > 0),
  content_json jsonb NOT NULL,
  workflow_status varchar(20) NOT NULL CHECK (workflow_status IN ('draft', 'pending_review', 'published', 'rejected')),
  created_by uuid NOT NULL REFERENCES users(id),
  reviewer_id uuid REFERENCES users(id),
  reason text,
  created_at timestamptz NOT NULL DEFAULT now(),
  reviewed_at timestamptz,
  UNIQUE (poi_id, version)
);
CREATE UNIQUE INDEX poi_one_pending_version_idx ON poi_content_versions (poi_id)
  WHERE workflow_status = 'pending_review';

CREATE TABLE audit_logs (
  id uuid PRIMARY KEY,
  actor_id uuid NOT NULL REFERENCES users(id),
  action varchar(100) NOT NULL,
  entity_type varchar(50) NOT NULL,
  entity_id uuid NOT NULL,
  before_json jsonb,
  after_json jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_logs_entity_idx ON audit_logs (entity_type, entity_id, created_at DESC);

COMMIT;
