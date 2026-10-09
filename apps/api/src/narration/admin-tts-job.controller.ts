import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Request,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import type {
  LatestTtsJobResponse,
  TtsGenerationJob,
} from '@damsen/shared-types';

import {
  AccessTokenGuard,
  Roles,
  RolesGuard,
  type AuthenticatedRequest,
} from '../auth/rbac.js';
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
 * Any RFC 4122 UUID. Narration ids are not always v4: migration 006 seeds
 * narrations with md5-derived ids (I02-9). Job ids are v4 but the same pipe
 * keeps the three routes consistent.
 */
const uuidPipe = () => new ParseUUIDPipe();

/**
 * Admin TTS job endpoints (contract v1 + additive v1.1 — see
 * apps/api/openapi.yaml, ADR 0010/0014). Visitors are rejected by the role
 * guards; jobs produce draft audio only and never approve or publish.
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
    @Param('narrationId', uuidPipe()) narrationId: string,
    @Body(bodyPipe(CreateTtsJobDto)) input: CreateTtsJobDto,
    @Request() request: AuthenticatedRequest,
  ): Promise<TtsGenerationJob> {
    return this.jobs.create(narrationId, input, request.principal!.userId);
  }

  @Get('narrations/:narrationId/tts-jobs/latest')
  @Roles('EDITOR', 'REVIEWER', 'ADMIN')
  latest(
    @Param('narrationId', uuidPipe()) narrationId: string,
  ): Promise<LatestTtsJobResponse> {
    return this.jobs.latest(narrationId);
  }

  @Get('tts-jobs/:jobId')
  @Roles('EDITOR', 'REVIEWER', 'ADMIN')
  get(@Param('jobId', uuidPipe()) jobId: string): Promise<TtsGenerationJob> {
    return this.jobs.get(jobId);
  }

  @Post('tts-jobs/:jobId/cancel')
  @Roles('EDITOR', 'ADMIN')
  @HttpCode(200)
  cancel(@Param('jobId', uuidPipe()) jobId: string): Promise<TtsGenerationJob> {
    return this.jobs.cancel(jobId);
  }
}
