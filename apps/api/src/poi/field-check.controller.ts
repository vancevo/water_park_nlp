import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Request,
  Res,
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import type { AdminPoi, FieldCheck } from '@damsen/shared-types';
import type { Response } from 'express';

import {
  AccessTokenGuard,
  Roles,
  RolesGuard,
  type AuthenticatedRequest,
} from '../auth/rbac.js';
import { ApplyFieldCheckDto, CreateFieldCheckDto } from './field-check.dto.js';
import { FieldCheckService } from './field-check.service.js';

const bodyPipe = <T>(expectedType: new () => T) =>
  new ValidationPipe({
    expectedType,
    forbidNonWhitelisted: true,
    transform: true,
    whitelist: true,
  });

@Controller('v1/admin')
@UseGuards(AccessTokenGuard, RolesGuard)
export class FieldCheckController {
  constructor(
    @Inject(FieldCheckService) private readonly checks: FieldCheckService,
  ) {}

  /** 201 when stored, 200 when the same clientId was already uploaded. */
  @Post('pois/:poiId/field-checks')
  @Roles('EDITOR', 'REVIEWER', 'ADMIN')
  async create(
    @Param('poiId', new ParseUUIDPipe({ version: '4' })) poiId: string,
    @Body(bodyPipe(CreateFieldCheckDto)) input: CreateFieldCheckDto,
    @Request() request: AuthenticatedRequest,
    @Res({ passthrough: true }) response: Response,
  ): Promise<FieldCheck> {
    const result = await this.checks.create(
      poiId,
      input,
      request.principal!.userId,
    );
    response.status(result.created ? 201 : 200);
    return result.check;
  }

  @Get('field-checks')
  @Roles('EDITOR', 'REVIEWER', 'ADMIN')
  list(
    @Query('poiId') poiId?: string,
    @Query('applied') applied?: string,
  ): Promise<FieldCheck[]> {
    return this.checks.list({
      ...(poiId ? { poiId } : {}),
      unappliedOnly: applied === 'false',
    });
  }

  @Post('field-checks/:checkId/apply')
  @Roles('REVIEWER', 'ADMIN')
  @HttpCode(200)
  apply(
    @Param('checkId', new ParseUUIDPipe({ version: '4' })) checkId: string,
    @Body(bodyPipe(ApplyFieldCheckDto)) input: ApplyFieldCheckDto,
    @Request() request: AuthenticatedRequest,
  ): Promise<AdminPoi> {
    return this.checks.apply(checkId, input, request.principal!.userId);
  }
}
