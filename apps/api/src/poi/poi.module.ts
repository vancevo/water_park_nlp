import { Module } from '@nestjs/common';

import { InMemoryPoiRepository } from './in-memory-poi.repository.js';
import { PoiController } from './poi.controller.js';
import { POI_CLOCK, POI_REPOSITORY, type PoiRepository } from './poi.models.js';
import {
  PostgresPoiRepository,
  type SqlClient,
} from './postgres-poi.repository.js';
import { PoiService } from './poi.service.js';
import { AuthModule } from '../auth/auth.module.js';
import { AdminPoiController } from './admin-poi.controller.js';
import { AdminPoiService } from './admin-poi.service.js';
import { createPgPool } from '../common/pg-pool.js';

function createRepository(): PoiRepository {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return new InMemoryPoiRepository();

  // `pg` is loaded only when a database is configured, so tests/dev fixtures do
  // not require an external service. Its Pool satisfies the small SqlClient port.
  return new PostgresPoiRepository(
    createPgPool<SqlClient>(connectionString, 'poi'),
  );
}

@Module({
  imports: [AuthModule],
  controllers: [PoiController, AdminPoiController],
  providers: [
    PoiService,
    AdminPoiService,
    { provide: POI_CLOCK, useValue: () => new Date() },
    { provide: POI_REPOSITORY, useFactory: createRepository },
  ],
  exports: [POI_REPOSITORY],
})
export class PoiModule {}
