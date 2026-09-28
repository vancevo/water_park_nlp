BEGIN;

CREATE TABLE analytics_events (
  event_id uuid PRIMARY KEY,
  schema_version smallint NOT NULL CHECK (schema_version = 1),
  event_type varchar(40) NOT NULL CHECK (
    event_type IN (
      'app_opened',
      'poi_viewed',
      'narration_started',
      'narration_completed',
      'route_requested',
      'route_started',
      'route_completed'
    )
  ),
  user_id uuid REFERENCES users(id) ON DELETE CASCADE,
  anonymous_session_id uuid,
  payload jsonb NOT NULL,
  occurred_at timestamptz NOT NULL,
  received_at timestamptz NOT NULL DEFAULT now(),
  retention_until timestamptz NOT NULL,
  consent_policy_version varchar(40) NOT NULL,
  CHECK ((user_id IS NULL) <> (anonymous_session_id IS NULL)),
  CHECK (jsonb_typeof(payload) = 'object'),
  CHECK (retention_until > received_at)
);

CREATE INDEX analytics_events_retention_idx
  ON analytics_events (retention_until);
CREATE INDEX analytics_events_type_time_idx
  ON analytics_events (event_type, occurred_at DESC);

COMMENT ON TABLE analytics_events IS
  'Consent-gated product analytics. Exact GPS, route geometry and direct PII are forbidden by the API contract.';
COMMENT ON COLUMN analytics_events.retention_until IS
  'Delete on or before this time. MVP API assigns a maximum 30-day retention window.';

COMMIT;
