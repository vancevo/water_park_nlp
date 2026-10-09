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
import { AdminTtsJobController } from './admin-tts-job.controller.js';
import { AdminTtsJobService } from './tts-job.service.js';
import { InMemoryTtsJobRepository } from './in-memory-tts-job.repository.js';
import { PostgresTtsJobRepository } from './postgres-tts-job.repository.js';
import {
  loadTtsJobControlsConfig,
  TTS_JOB_CONTROLS,
  TtsJobControls,
} from './tts-job-controls.js';
import {
  loadTtsJobDefaults,
  usesFallbackTtsDefaults,
  TTS_JOB_CLOCK,
  TTS_JOB_DEFAULTS,
  TTS_JOB_REPOSITORY,
  type TtsJobRepository,
} from './tts-job.models.js';

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

function createTtsJobDefaults() {
  if (usesFallbackTtsDefaults() && process.env.NODE_ENV !== 'test') {
    console.warn(
      'TTS: no TTS_VOICES_MANIFEST_PATH or TTS_DEFAULT_MODEL_VERSION; jobs use fallback defaults that no worker voice serves (they will fail with TTS_MODEL_UNAVAILABLE).',
    );
  }
  return loadTtsJobDefaults();
}

function createTtsJobRepository(): TtsJobRepository {
  const client = sqlClient();
  return client
    ? new PostgresTtsJobRepository(client)
    : new InMemoryTtsJobRepository();
}

@Module({
  imports: [AuthModule, PoiModule],
  controllers: [
    NarrationController,
    NarrationLocalesController,
    AdminNarrationController,
    AdminTtsJobController,
  ],
  providers: [
    NarrationService,
    NarrationLocalesService,
    MediaService,
    AdminTtsJobService,
    { provide: TTS_JOB_CLOCK, useValue: () => new Date() },
    { provide: TTS_JOB_DEFAULTS, useFactory: createTtsJobDefaults },
    {
      provide: TTS_JOB_CONTROLS,
      useFactory: () => new TtsJobControls(loadTtsJobControlsConfig()),
    },
    { provide: TTS_JOB_REPOSITORY, useFactory: createTtsJobRepository },
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
