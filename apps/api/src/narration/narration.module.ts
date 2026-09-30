import { Module } from '@nestjs/common';
import { createRequire } from 'node:module';
import { loadNarrationLocaleConfig } from '@damsen/config';

import { AuthModule } from '../auth/auth.module.js';
import type { SqlClient } from '../poi/postgres-poi.repository.js';
import { PoiModule } from '../poi/poi.module.js';
import { AdminNarrationController } from './admin-narration.controller.js';
import { InMemoryNarrationRepository } from './in-memory-narration.repository.js';
import {
  NARRATION_CLOCK,
  NARRATION_REPOSITORY,
  type NarrationRepository,
} from './narration.models.js';
import { NarrationController } from './narration.controller.js';
import { NarrationLocalesController } from './narration-locales.controller.js';
import { NarrationLocalesService } from './narration-locales.service.js';
import { NARRATION_LOCALE_CONFIG } from './narration-locales.models.js';
import { NarrationService } from './narration.service.js';
import { PostgresNarrationRepository } from './postgres-narration.repository.js';
import { createMediaStorage, MEDIA_STORAGE } from './media-storage.js';
import { MediaService } from './media.service.js';

function sqlClient(): SqlClient | null {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return null;
  const require = createRequire(import.meta.url);
  const pg = require('pg') as {
    Pool: new (options: { connectionString: string }) => SqlClient;
  };
  return new pg.Pool({ connectionString });
}

function createRepository(): NarrationRepository {
  const client = sqlClient();
  return client
    ? new PostgresNarrationRepository(client)
    : new InMemoryNarrationRepository();
}

@Module({
  imports: [AuthModule, PoiModule],
  controllers: [
    NarrationController,
    NarrationLocalesController,
    AdminNarrationController,
  ],
  providers: [
    NarrationService,
    NarrationLocalesService,
    MediaService,
    {
      provide: NARRATION_LOCALE_CONFIG,
      useFactory: () => loadNarrationLocaleConfig(),
    },
    { provide: NARRATION_CLOCK, useValue: () => new Date() },
    {
      provide: NARRATION_REPOSITORY,
      useFactory: createRepository,
    },
    { provide: MEDIA_STORAGE, useFactory: createMediaStorage },
  ],
})
export class NarrationModule {}
