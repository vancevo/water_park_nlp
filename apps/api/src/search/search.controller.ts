import { Controller, Get, Inject, Query, ValidationPipe } from '@nestjs/common';
import type { SearchResponse } from '@damsen/shared-types';

import { SearchQueryDto } from './search.dto.js';
import { SearchService } from './search.service.js';

const queryPipe = new ValidationPipe({
  expectedType: SearchQueryDto,
  forbidNonWhitelisted: true,
  transform: true,
  whitelist: true,
});

@Controller('v1/search')
export class SearchController {
  constructor(
    @Inject(SearchService) private readonly searchService: SearchService,
  ) {}

  @Get()
  search(@Query(queryPipe) query: SearchQueryDto): Promise<SearchResponse> {
    return this.searchService.search(query);
  }
}
