import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Request,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import type {
  AdminNarration,
  NarrationAudioPlayback,
} from '@damsen/shared-types';

import {
  AccessTokenGuard,
  Roles,
  RolesGuard,
  type AuthenticatedRequest,
} from '../auth/rbac.js';
import {
  CreateNarrationDto,
  RejectNarrationDto,
  UpdateNarrationDto,
} from './narration.dto.js';
import { NarrationService } from './narration.service.js';
import { MediaUploadIntentDto } from './media.dto.js';
import { MediaService } from './media.service.js';
import type { MediaUploadIntent } from '@damsen/shared-types';
import { ParseUuidShapePipe } from '../common/uuid-shape.pipe.js';

const bodyPipe = <T>(expectedType: new () => T) =>
  new ValidationPipe({
    expectedType,
    forbidNonWhitelisted: true,
    transform: true,
    whitelist: true,
  });

// Narration `:id` params are shape-only UUIDs: seeded narrations use
// md5-derived ids with arbitrary version/variant bits (I02-9, I04). POI ids stay v4.
@Controller('v1/admin')
@UseGuards(AccessTokenGuard, RolesGuard)
export class AdminNarrationController {
  constructor(
    @Inject(NarrationService) private readonly narrations: NarrationService,
    @Inject(MediaService) private readonly media: MediaService,
  ) {}

  @Post('media/presign')
  @Roles('EDITOR', 'ADMIN')
  createUploadIntent(
    @Body(bodyPipe(MediaUploadIntentDto)) input: MediaUploadIntentDto,
  ): Promise<MediaUploadIntent> {
    return this.media.createUploadIntent(input);
  }

  @Get('pois/:poiId/narrations')
  @Roles('EDITOR', 'REVIEWER', 'ADMIN')
  list(
    @Param('poiId', new ParseUUIDPipe({ version: '4' })) poiId: string,
  ): Promise<AdminNarration[]> {
    return this.narrations.list(poiId);
  }

  @Post('pois/:poiId/narrations')
  @Roles('EDITOR', 'ADMIN')
  create(
    @Param('poiId', new ParseUUIDPipe({ version: '4' })) poiId: string,
    @Body(bodyPipe(CreateNarrationDto)) input: CreateNarrationDto,
    @Request() request: AuthenticatedRequest,
  ): Promise<AdminNarration> {
    return this.narrations.create(poiId, input, request.principal!.userId);
  }

  @Patch('narrations/:id')
  @Roles('EDITOR', 'ADMIN')
  update(
    @Param('id', new ParseUuidShapePipe()) id: string,
    @Body(bodyPipe(UpdateNarrationDto)) input: UpdateNarrationDto,
  ): Promise<AdminNarration> {
    return this.narrations.update(id, input);
  }

  @Delete('narrations/:id')
  @Roles('EDITOR', 'ADMIN')
  @HttpCode(204)
  remove(@Param('id', new ParseUuidShapePipe()) id: string): Promise<void> {
    return this.narrations.remove(id);
  }

  /** v1.1: preview the current (draft) audio — e.g. AI audio before submit. */
  @Get('narrations/:id/audio/playback')
  @Roles('EDITOR', 'REVIEWER', 'ADMIN')
  audioPlayback(
    @Param('id', new ParseUuidShapePipe()) id: string,
  ): Promise<NarrationAudioPlayback> {
    return this.narrations.audioPlayback(id);
  }

  @Post('narrations/:id/submit')
  @Roles('EDITOR', 'ADMIN')
  @HttpCode(200)
  submit(
    @Param('id', new ParseUuidShapePipe()) id: string,
  ): Promise<AdminNarration> {
    return this.narrations.submit(id);
  }

  @Post('narrations/:id/approve')
  @Roles('REVIEWER', 'ADMIN')
  @HttpCode(200)
  approve(
    @Param('id', new ParseUuidShapePipe()) id: string,
    @Request() request: AuthenticatedRequest,
  ): Promise<AdminNarration> {
    return this.narrations.approve(id, request.principal!.userId);
  }

  @Post('narrations/:id/reject')
  @Roles('REVIEWER', 'ADMIN')
  @HttpCode(200)
  reject(
    @Param('id', new ParseUuidShapePipe()) id: string,
    @Body(bodyPipe(RejectNarrationDto)) input: RejectNarrationDto,
    @Request() request: AuthenticatedRequest,
  ): Promise<AdminNarration> {
    return this.narrations.reject(id, input.reason, request.principal!.userId);
  }
}
