import { Module } from '@nestjs/common';

import { HealthController } from './health/health.controller.js';
import { AuthModule } from './auth/auth.module.js';
import { PoiModule } from './poi/poi.module.js';
import { RoutingModule } from './routing/routing.module.js';
import { NarrationModule } from './narration/narration.module.js';
import { SearchModule } from './search/search.module.js';
import { AnalyticsModule } from './analytics/analytics.module.js';
import { OperationsModule } from './operations/operations.module.js';

@Module({
  imports: [
    AuthModule,
    PoiModule,
    RoutingModule,
    NarrationModule,
    SearchModule,
    AnalyticsModule,
    OperationsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
