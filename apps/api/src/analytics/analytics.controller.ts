import {
  Body,
  Controller,
  Inject,
  Post,
  Req,
  UnauthorizedException,
} from '@nestjs/common';
import type { AnalyticsBatchResponse } from '@damsen/shared-types';
import type { Request } from 'express';

import { AUTH_CLOCK } from '../auth/auth.models.js';
import { TokenService } from '../auth/token.service.js';
import { AnalyticsBatchDto } from './analytics.dto.js';
import { AnalyticsService } from './analytics.service.js';

@Controller('v1/events')
export class AnalyticsController {
  constructor(
    @Inject(AnalyticsService)
    private readonly analytics: AnalyticsService,
    @Inject(TokenService) private readonly tokens: TokenService,
    @Inject(AUTH_CLOCK) private readonly clock: () => Date,
  ) {}

  @Post('batch')
  ingest(
    @Body() input: AnalyticsBatchDto,
    @Req() request: Request,
  ): Promise<AnalyticsBatchResponse> {
    const authorization = request.headers.authorization;
    if (!authorization) return this.analytics.ingest(input, {});
    if (!authorization.startsWith('Bearer ')) throw new UnauthorizedException();
    const principal = this.tokens.verifyAccess(
      authorization.slice(7),
      this.clock(),
    );
    return this.analytics.ingest(input, { userId: principal.userId });
  }
}
