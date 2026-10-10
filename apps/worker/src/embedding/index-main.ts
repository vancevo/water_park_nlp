import { createRequire } from 'node:module';

import { EmbeddingService } from './embedding-service.js';
import { HttpEmbeddingProvider } from './http-embedding-provider.js';
import {
  PostgresEmbeddingRepository,
  type SqlQueryClient,
} from './postgres-embedding.repository.js';

/**
 * Index (embed) every published POI translation into `semantic_embeddings`
 * through the embedding service (C06):
 *
 *   DATABASE_URL=… EMBEDDING_URL=http://127.0.0.1:8091 \
 *     npm run embeddings:index --workspace @damsen/worker
 *
 * Idempotent: unchanged documents (same content hash + model/version) are
 * skipped; `--force` re-embeds everything. Prints counts only.
 */

const url = process.env.EMBEDDING_URL?.trim() || 'http://127.0.0.1:8091';
const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) {
  console.error('DATABASE_URL is required');
  process.exit(2);
}

const require = createRequire(import.meta.url);
const pg = require('pg') as {
  Pool: new (options: {
    connectionString: string;
    max?: number;
  }) => SqlQueryClient & {
    end(): Promise<void>;
  };
};
const pool = new pg.Pool({ connectionString: databaseUrl, max: 2 });

try {
  const provider = await HttpEmbeddingProvider.connect({ url });
  const result = await new EmbeddingService(
    new PostgresEmbeddingRepository(pool),
    provider,
  ).run({ force: process.argv.includes('--force'), batchSize: 16 });
  console.log(
    `embeddings: ${provider.model}@${provider.modelVersion} — scanned ${result.scanned}, embedded ${result.embedded}, unchanged ${result.skipped}`,
  );
} catch (error) {
  console.error(
    `embeddings: failed (${error instanceof Error ? error.message : 'unknown'})`,
  );
  process.exitCode = 1;
} finally {
  await pool.end();
}
