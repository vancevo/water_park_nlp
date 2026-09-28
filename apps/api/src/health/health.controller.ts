import { Controller, Get } from '@nestjs/common';
import type { HealthResponse } from '@damsen/shared-types';

@Controller('health')
export class HealthController {
  @Get()
  getHealth(): HealthResponse {
    return { status: 'ok' };
  }
}
