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
  UseGuards,
  ValidationPipe,
} from '@nestjs/common';
import type { AdminPoi, AuditLogEntry } from '@damsen/shared-types';

import {
  AccessTokenGuard,
  Roles,
  RolesGuard,
  type AuthenticatedRequest,
} from '../auth/rbac.js';
import { Request } from '@nestjs/common';
import {
  CreateAdminPoiDto,
  UpdateAdminPoiDto,
  WorkflowReasonDto,
} from './admin-poi.dto.js';
import { AdminPoiService } from './admin-poi.service.js';

const bodyPipe = <T>(expectedType: new () => T) =>
  new ValidationPipe({
    expectedType,
    forbidNonWhitelisted: true,
    transform: true,
    whitelist: true,
  });

@Controller('v1/admin')
@UseGuards(AccessTokenGuard, RolesGuard)
export class AdminPoiController {
  constructor(
    @Inject(AdminPoiService) private readonly pois: AdminPoiService,
  ) {}

  @Get('pois')
  @Roles('EDITOR', 'REVIEWER', 'ADMIN')
  list(): Promise<AdminPoi[]> {
    return this.pois.list();
  }

  @Post('pois')
  @Roles('EDITOR', 'ADMIN')
  create(
    @Body(bodyPipe(CreateAdminPoiDto)) input: CreateAdminPoiDto,
    @Request() request: AuthenticatedRequest,
  ): Promise<AdminPoi> {
    return this.pois.create(input, request.principal!.userId);
  }

  @Patch('pois/:id')
  @Roles('EDITOR', 'ADMIN')
  update(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body(bodyPipe(UpdateAdminPoiDto)) input: UpdateAdminPoiDto,
    @Request() request: AuthenticatedRequest,
  ): Promise<AdminPoi> {
    return this.pois.update(id, input, request.principal!.userId);
  }

  @Delete('pois/:id')
  @Roles('EDITOR', 'ADMIN')
  @HttpCode(204)
  remove(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Request() request: AuthenticatedRequest,
  ): Promise<void> {
    return this.pois.remove(id, request.principal!.userId);
  }

  @Post('pois/:id/submit')
  @Roles('EDITOR', 'ADMIN')
  @HttpCode(200)
  submit(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Request() request: AuthenticatedRequest,
  ): Promise<AdminPoi> {
    return this.pois.submit(id, request.principal!.userId);
  }

  @Post('content/:versionId/approve')
  @Roles('REVIEWER', 'ADMIN')
  @HttpCode(200)
  approve(
    @Param('versionId', new ParseUUIDPipe({ version: '4' })) versionId: string,
    @Request() request: AuthenticatedRequest,
  ): Promise<AdminPoi> {
    return this.pois.approve(versionId, request.principal!.userId);
  }

  @Post('content/:versionId/reject')
  @Roles('REVIEWER', 'ADMIN')
  @HttpCode(200)
  reject(
    @Param('versionId', new ParseUUIDPipe({ version: '4' })) versionId: string,
    @Body(bodyPipe(WorkflowReasonDto)) input: WorkflowReasonDto,
    @Request() request: AuthenticatedRequest,
  ): Promise<AdminPoi> {
    return this.pois.reject(versionId, input.reason, request.principal!.userId);
  }

  @Get('audit-logs')
  @Roles('ADMIN')
  audit(): Promise<AuditLogEntry[]> {
    return this.pois.auditLog();
  }
}
