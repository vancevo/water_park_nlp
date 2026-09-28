import { Module } from '@nestjs/common';
import { createRequire } from 'node:module';

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

function createRepository(): AnalyticsRepository {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return new InMemoryAnalyticsRepository();
  const require = createRequire(import.meta.url);
  const pg = require('pg') as {
    Pool: new (options: { connectionString: string }) => SqlClient;
  };
  return new PostgresAnalyticsRepository(new pg.Pool({ connectionString }));
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
