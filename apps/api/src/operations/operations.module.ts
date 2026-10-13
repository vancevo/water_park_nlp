import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { createPgPool } from '../common/pg-pool.js';
import { InMemoryOperationsRepository } from './in-memory-operations.repository.js';
import {
  CashierOperationsController,
  DemoPaymentController,
  LoyaltyController,
  PresenceController,
  VisitorPresenceController,
  AdminPresenceController,
  OperationsDashboardController,
  AdminLoyaltyController,
} from './operations.controller.js';
import { OperationsEvents } from './operations.events.js';
import {
  OPERATIONS_CLOCK,
  OPERATIONS_REPOSITORY,
  OPERATIONS_SLEEP,
  type OperationsRepository,
} from './operations.models.js';
import {
  PostgresOperationsRepository,
  type OperationsPool,
} from './postgres-operations.repository.js';
import { OperationsService } from './operations.service.js';
import { PresenceService } from './presence.service.js';
import { RealtimeGateway } from '../realtime/realtime.gateway.js';
import {
  MemoryPresenceStore,
  PRESENCE_STORE,
  RedisPresenceStore,
  ResilientPresenceStore,
  type PresenceStore,
} from './presence.store.js';
import { loadRuntimeConfig } from '@damsen/config';
import { OutboxRelayService } from '../outbox/outbox-relay.service.js';

function createRepository(): OperationsRepository {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) return new InMemoryOperationsRepository();
  return new PostgresOperationsRepository(
    createPgPool<OperationsPool>(connectionString, 'operations'),
  );
}

async function createPresenceStore(): Promise<PresenceStore> {
  const config = loadRuntimeConfig();
  const memory = new MemoryPresenceStore();
  if (!config.realtime.redisEnabled) return memory;
  const redis = new RedisPresenceStore(config.redisUrl);
  try {
    await redis.connect();
    return new ResilientPresenceStore(redis, memory);
  } catch {
    await redis.close();
    return memory;
  }
}

@Module({
  imports: [AuthModule],
  controllers: [
    CashierOperationsController,
    DemoPaymentController,
    LoyaltyController,
    OperationsDashboardController,
    AdminLoyaltyController,
    PresenceController,
    VisitorPresenceController,
    AdminPresenceController,
  ],
  providers: [
    OperationsService,
    OperationsEvents,
    PresenceService,
    RealtimeGateway,
    OutboxRelayService,
    { provide: OPERATIONS_REPOSITORY, useFactory: createRepository },
    { provide: PRESENCE_STORE, useFactory: createPresenceStore },
    { provide: OPERATIONS_CLOCK, useValue: () => new Date() },
    {
      provide: OPERATIONS_SLEEP,
      useValue: (milliseconds: number) =>
        new Promise<void>((resolve) => setTimeout(resolve, milliseconds)),
    },
  ],
  exports: [OperationsService, OperationsEvents, OPERATIONS_REPOSITORY],
})
export class OperationsModule {}
