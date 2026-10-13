import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  ExpressAdapter,
  type NestExpressApplication,
} from '@nestjs/platform-express';

import { AppModule } from './app.module.js';
import { ApiExceptionFilter } from './common/api-exception.filter.js';
import { requestIdMiddleware } from './common/request-id.middleware.js';
import { RedisIoAdapter } from './realtime/redis-io.adapter.js';
import { loadRuntimeConfig } from '@damsen/config';

export async function createApp(): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(
    AppModule,
    new ExpressAdapter(),
    {
      abortOnError: false,
      logger: false,
    },
  );

  app.use(requestIdMiddleware);
  app.useGlobalPipes(
    new ValidationPipe({
      forbidNonWhitelisted: true,
      transform: true,
      whitelist: true,
    }),
  );
  app.useGlobalFilters(new ApiExceptionFilter());

  const config = loadRuntimeConfig();
  if (config.realtime.redisEnabled) {
    const adapter = new RedisIoAdapter(app, config.redisUrl);
    if (await adapter.connect()) app.useWebSocketAdapter(adapter);
  }

  return app;
}
