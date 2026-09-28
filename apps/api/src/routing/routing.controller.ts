import { Body, Controller, Inject, Post } from '@nestjs/common';
import type { RouteResponse } from '@damsen/shared-types';

import { CreateRouteDto } from './routing.dto.js';
import { RoutingService } from './routing.service.js';

@Controller('v1/routes')
export class RoutingController {
  constructor(
    @Inject(RoutingService) private readonly routingService: RoutingService,
  ) {}

  @Post()
  create(@Body() input: CreateRouteDto): Promise<RouteResponse> {
    return this.routingService.create(input);
  }
}
