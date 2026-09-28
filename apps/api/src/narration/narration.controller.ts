import {
  Controller,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Query,
  ValidationPipe,
} from '@nestjs/common';
import type { PoiNarration } from '@damsen/shared-types';

import { NarrationLocaleQueryDto } from './narration.dto.js';
import { NarrationService } from './narration.service.js';

const queryPipe = new ValidationPipe({
  expectedType: NarrationLocaleQueryDto,
  forbidNonWhitelisted: true,
  transform: true,
  whitelist: true,
});

@Controller('v1/pois/:poiId/narration')
export class NarrationController {
  constructor(
    @Inject(NarrationService) private readonly narrations: NarrationService,
  ) {}

  @Get()
  get(
    @Param('poiId', new ParseUUIDPipe({ version: '4' })) poiId: string,
    @Query(queryPipe) query: NarrationLocaleQueryDto,
  ): Promise<PoiNarration> {
    return this.narrations.published(poiId, query.locale);
  }
}
