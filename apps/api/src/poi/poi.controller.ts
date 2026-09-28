import {
  Controller,
  Get,
  Inject,
  Param,
  ParseUUIDPipe,
  Query,
  ValidationPipe,
} from '@nestjs/common';
import type { PoiDetail, PoiListResponse } from '@damsen/shared-types';

import { PoiDetailQueryDto, PoiListQueryDto } from './poi-query.dto.js';
import { PoiService } from './poi.service.js';

const listQueryPipe = new ValidationPipe({
  expectedType: PoiListQueryDto,
  forbidNonWhitelisted: true,
  transform: true,
  whitelist: true,
});

const detailQueryPipe = new ValidationPipe({
  expectedType: PoiDetailQueryDto,
  forbidNonWhitelisted: true,
  transform: true,
  whitelist: true,
});

@Controller('v1/pois')
export class PoiController {
  constructor(@Inject(PoiService) private readonly poiService: PoiService) {}

  @Get()
  list(@Query(listQueryPipe) query: PoiListQueryDto): Promise<PoiListResponse> {
    return this.poiService.list(query);
  }

  @Get(':id')
  detail(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Query(detailQueryPipe) query: PoiDetailQueryDto,
  ): Promise<PoiDetail> {
    return this.poiService.detail(id, query.locale);
  }
}
