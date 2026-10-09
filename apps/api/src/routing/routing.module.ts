import { Module } from '@nestjs/common';

import type { SqlClient } from '../poi/postgres-poi.repository.js';
import { InMemoryRoutingRepository } from './in-memory-routing.repository.js';
import { PostgresRoutingRepository } from './postgres-routing.repository.js';
import { RoutingController } from './routing.controller.js';
import {
  ROUTING_REPOSITORY,
  type RoutingRepository,
} from './routing.models.js';
import { RoutingService } from './routing.service.js';
import { createPgPool } from '../common/pg-pool.js';

function createRepository(): RoutingRepository {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return new InMemoryRoutingRepository();
  return new PostgresRoutingRepository(
    createPgPool<SqlClient>(connectionString, 'routing'),
  );
}

@Module({
  controllers: [RoutingController],
  providers: [
    RoutingService,
    { provide: ROUTING_REPOSITORY, useFactory: createRepository },
  ],
})
export class RoutingModule {}
