import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import type { TtsGenerationJob } from '@damsen/shared-types';

import { AccessTokenGuard, Roles, RolesGuard } from '../auth/rbac.js';
import { CreateTtsJobDto } from './tts-job.dto.js';
import { AdminTtsJobService } from './tts-job.service.js';

const bodyPipe = <T>(expectedType: new () => T) =>
  new ValidationPipe({
    expectedType,
    forbidNonWhitelisted: true,
    transform: true,
    whitelist: true,
  });

/**
 * Admin TTS job endpoints (contract v1 — see apps/api/openapi.yaml). Visitors
 * are rejected by the role guards; jobs are enqueued as drafts only and never
 * auto-approve or publish a narration.
 */
@Controller('v1/admin')
@UseGuards(AccessTokenGuard, RolesGuard)
export class AdminTtsJobController {
  constructor(
    @Inject(AdminTtsJobService) private readonly jobs: AdminTtsJobService,
  ) {}

  @Post('narrations/:narrationId/tts-jobs')
  @Roles('EDITOR', 'ADMIN')
  @HttpCode(202)
  create(
    @Param('narrationId', new ParseUUIDPipe({ version: '4' }))
    narrationId: string,
    @Body(bodyPipe(CreateTtsJobDto)) input: CreateTtsJobDto,
  ): Promise<TtsGenerationJob> {
    return this.jobs.create(narrationId, input);
  }

  @Get('tts-jobs/:jobId')
  @Roles('EDITOR', 'REVIEWER', 'ADMIN')
  get(
    @Param('jobId', new ParseUUIDPipe({ version: '4' })) jobId: string,
  ): Promise<TtsGenerationJob> {
    return this.jobs.get(jobId);
  }

  @Post('tts-jobs/:jobId/cancel')
  @Roles('EDITOR', 'ADMIN')
  @HttpCode(200)
  cancel(
    @Param('jobId', new ParseUUIDPipe({ version: '4' })) jobId: string,
  ): Promise<TtsGenerationJob> {
    return this.jobs.cancel(jobId);
  }
}
