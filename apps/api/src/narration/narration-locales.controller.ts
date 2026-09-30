import { Controller, Get, Inject } from '@nestjs/common';
import type { NarrationLocaleCatalog } from '@damsen/shared-types';

import { NarrationLocalesService } from './narration-locales.service.js';

/**
 * Public narration-locale catalog. Lists enabled locales only, in configured
 * order, and exposes no filesystem path or disabled entries.
 */
@Controller('v1/narration-locales')
export class NarrationLocalesController {
  constructor(
    @Inject(NarrationLocalesService)
    private readonly locales: NarrationLocalesService,
  ) {}

  @Get()
  get(): NarrationLocaleCatalog {
    return this.locales.catalog();
  }
}
