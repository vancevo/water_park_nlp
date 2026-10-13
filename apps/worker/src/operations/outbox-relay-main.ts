/* global console, setInterval */
import process from 'node:process';

import { Emitter } from '@socket.io/redis-emitter';
import pg from 'pg';
import { createClient } from 'redis';

import {
  OperationsOutboxRelay,
  type OutboxRealtimePublisher,
} from './outbox-relay.js';

const databaseUrl = process.env.DATABASE_URL?.trim();
const redisUrl = process.env.REDIS_URL?.trim();
if (!databaseUrl || !redisUrl) {
  console.error('DATABASE_URL and REDIS_URL are required');
  process.exit(2);
}
if (process.env.OPERATIONS_OUTBOX_RELAY_ENABLED !== 'true') {
  console.error('OPERATIONS_OUTBOX_RELAY_ENABLED=true is required');
  process.exit(2);
}

const pool = new pg.Pool({ connectionString: databaseUrl, max: 2 });
const redis = createClient({ url: redisUrl });
await redis.connect();
const emitter = new Emitter(redis).of('/realtime');
const publisher: OutboxRealtimePublisher = {
  nextSequence: (stream) => redis.incr(`operations:sequence:${stream}`),
  emit: (room, eventType, event) => {
    emitter.to(room).emit(eventType, event);
  },
};
const relay = new OperationsOutboxRelay(pool, publisher);
let draining = false;
const drain = async () => {
  if (draining) return;
  draining = true;
  try {
    await relay.drain();
  } catch {
    // Health tooling observes pending/dead-letter counts; do not log payloads.
  } finally {
    draining = false;
  }
};
const timer = setInterval(() => void drain(), 1_000);
void drain();

const shutdown = async () => {
  clearInterval(timer);
  await redis.close();
  await pool.end();
};
process.once('SIGINT', () => void shutdown().finally(() => process.exit(0)));
process.once('SIGTERM', () => void shutdown().finally(() => process.exit(0)));
