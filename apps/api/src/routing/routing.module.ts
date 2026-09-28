import { Module } from '@nestjs/common';
import { createRequire } from 'node:module';

import type { SqlClient } from '../poi/postgres-poi.repository.js';
import { InMemoryRoutingRepository } from './in-memory-routing.repository.js';
import { PostgresRoutingRepository } from './postgres-routing.repository.js';
import { RoutingController } from './routing.controller.js';
import {
  ROUTING_REPOSITORY,
  type RoutingRepository,
} from './routing.models.js';
import { RoutingService } from './routing.service.js';

function createRepository(): RoutingRepository {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return new InMemoryRoutingRepository();
  const require = createRequire(import.meta.url);
  const pg = require('pg') as {
    Pool: new (options: { connectionString: string }) => SqlClient;
  };
  return new PostgresRoutingRepository(new pg.Pool({ connectionString }));
}

@Module({
  controllers: [RoutingController],
  providers: [
    RoutingService,
    { provide: ROUTING_REPOSITORY, useFactory: createRepository },
  ],
})
export class RoutingModule {}
