import { Module } from '@nestjs/common';
import { createRequire } from 'node:module';

import type { SqlClient } from '../poi/postgres-poi.repository.js';
import { InMemorySearchRepository } from './in-memory-search.repository.js';
import { PostgresSearchRepository } from './postgres-search.repository.js';
import { SearchController } from './search.controller.js';
import {
  SEARCH_CLOCK,
  SEARCH_REPOSITORY,
  type SearchRepository,
} from './search.models.js';
import { SearchService } from './search.service.js';

function createRepository(): SearchRepository {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return new InMemorySearchRepository();
  const require = createRequire(import.meta.url);
  const pg = require('pg') as {
    Pool: new (options: { connectionString: string }) => SqlClient;
  };
  return new PostgresSearchRepository(new pg.Pool({ connectionString }));
}

@Module({
  controllers: [SearchController],
  providers: [
    SearchService,
    { provide: SEARCH_CLOCK, useValue: () => new Date() },
    { provide: SEARCH_REPOSITORY, useFactory: createRepository },
  ],
})
export class SearchModule {}
