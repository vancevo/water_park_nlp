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
import { FieldCheckController } from './field-check.controller.js';
import {
  FIELD_CHECK_REPOSITORY,
  type FieldCheckRepository,
} from './field-check.models.js';
import { FieldCheckService } from './field-check.service.js';
import { InMemoryFieldCheckRepository } from './in-memory-field-check.repository.js';
import { PostgresFieldCheckRepository } from './postgres-field-check.repository.js';
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

// Same pool as the POI repository would be nicer, but each repository keeps its own
// small pool (the existing pattern); field checks are low volume.
function createFieldCheckRepository(): FieldCheckRepository {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return new InMemoryFieldCheckRepository();
  return new PostgresFieldCheckRepository(
    createPgPool<SqlClient>(connectionString, 'field-checks'),
  );
}

@Module({
  imports: [AuthModule],
  controllers: [PoiController, AdminPoiController, FieldCheckController],
  providers: [
    PoiService,
    AdminPoiService,
    FieldCheckService,
    {
      provide: FIELD_CHECK_REPOSITORY,
      useFactory: createFieldCheckRepository,
    },
    { provide: POI_CLOCK, useValue: () => new Date() },
    { provide: POI_REPOSITORY, useFactory: createRepository },
  ],
  exports: [POI_REPOSITORY],
})
export class PoiModule {}
