import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module.js';
import type { SqlClient } from '../poi/postgres-poi.repository.js';
import { AnalyticsController } from './analytics.controller.js';
import {
  ANALYTICS_CLOCK,
  ANALYTICS_REPOSITORY,
  type AnalyticsRepository,
} from './analytics.models.js';
import { AnalyticsService } from './analytics.service.js';
import { InMemoryAnalyticsRepository } from './in-memory-analytics.repository.js';
import { PostgresAnalyticsRepository } from './postgres-analytics.repository.js';
import { createPgPool } from '../common/pg-pool.js';

function createRepository(): AnalyticsRepository {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return new InMemoryAnalyticsRepository();
  return new PostgresAnalyticsRepository(
    createPgPool<SqlClient>(connectionString, 'analytics'),
  );
}

@Module({
  imports: [AuthModule],
  controllers: [AnalyticsController],
  providers: [
    AnalyticsService,
    { provide: ANALYTICS_CLOCK, useValue: () => new Date() },
    { provide: ANALYTICS_REPOSITORY, useFactory: createRepository },
  ],
})
export class AnalyticsModule {}
