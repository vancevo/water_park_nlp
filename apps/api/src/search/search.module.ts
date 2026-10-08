import { Module } from '@nestjs/common';
import { createRequire } from 'node:module';

import type { SqlClient } from '../poi/postgres-poi.repository.js';
import { InMemorySearchRepository } from './in-memory-search.repository.js';
import { PostgresSearchRepository } from './postgres-search.repository.js';
import { SearchController } from './search.controller.js';
import {
  SEARCH_CLOCK,
  SEARCH_HYBRID,
  SEARCH_REPOSITORY,
  type HybridSearchDeps,
  type SearchRepository,
  type VectorCandidateSource,
} from './search.models.js';
import { SearchService } from './search.service.js';
import { loadSearchFlags } from './search-flags.js';
import { loadQueryEmbedder } from './query-embedder.js';
import { InMemoryVectorCandidateSource } from './in-memory-vector.source.js';
import { PostgresVectorCandidateSource } from './postgres-vector.source.js';

function sqlClient(): SqlClient | null {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return null;
  const require = createRequire(import.meta.url);
  const pg = require('pg') as {
    Pool: new (options: { connectionString: string }) => SqlClient;
  };
  return new pg.Pool({ connectionString });
}

function createRepository(): SearchRepository {
  const client = sqlClient();
  return client
    ? new PostgresSearchRepository(client)
    : new InMemorySearchRepository();
}

/**
 * Hybrid dependencies (AI07). Built once from env. When the flag is off the
 * service ignores them; when on, the query embedder (null unless
 * SEARCH_EMBEDDING_URL is set) and the vector source (pgvector with a DB, else
 * an empty in-memory stub) drive semantic re-ranking with lexical fallback.
 */
function createHybrid(): HybridSearchDeps {
  const flags = loadSearchFlags();
  const embedder = loadQueryEmbedder();
  const client = sqlClient();
  const vectorSource: VectorCandidateSource = client
    ? new PostgresVectorCandidateSource(
        client,
        embedder.model,
        embedder.modelVersion,
      )
    : new InMemoryVectorCandidateSource();
  return { flags, embedder, vectorSource };
}

@Module({
  controllers: [SearchController],
  providers: [
    SearchService,
    { provide: SEARCH_CLOCK, useValue: () => new Date() },
    { provide: SEARCH_REPOSITORY, useFactory: createRepository },
    { provide: SEARCH_HYBRID, useFactory: createHybrid },
  ],
})
export class SearchModule {}
