BEGIN;

CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE semantic_embeddings (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  entity_type varchar(50) NOT NULL,
  entity_id uuid NOT NULL,
  locale varchar(5) NOT NULL CHECK (locale IN ('vi', 'en')),
  model varchar(100) NOT NULL,
  model_version varchar(100) NOT NULL,
  content_hash char(64) NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),
  embedding vector(1024) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT semantic_embeddings_identity_version_unique
    UNIQUE (entity_type, entity_id, locale, model, model_version)
);

CREATE INDEX semantic_embeddings_model_version_idx
  ON semantic_embeddings (entity_type, locale, model, model_version);

CREATE INDEX semantic_embeddings_hnsw_cosine_idx
  ON semantic_embeddings USING hnsw (embedding vector_cosine_ops);

COMMIT;
