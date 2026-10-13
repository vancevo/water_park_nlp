import { createClient } from 'redis';
import { describe, expect, it } from 'vitest';

import {
  MemoryPresenceStore,
  PRESENCE_TTL_SECONDS,
  RedisPresenceStore,
  ResilientPresenceStore,
  type LivePresence,
  type PresenceStore,
} from '../src/operations/presence.store.js';

const session = (id: string, sequence = 1): LivePresence => ({
  id,
  userId: 'user-test',
  pseudonym: 'Ẩn danh TEST',
  avatarVariant: 1,
  shareIdentity: false,
  visibleToVisitors: true,
  locationMode: 'simulated',
  lastSequence: sequence,
  latitude: 10.787,
  longitude: 106.697,
  accuracyMeters: 8,
  updatedAt: new Date().toISOString(),
});

const failingStore: PresenceStore = {
  save: async () => Promise.reject(new Error('REDIS_DOWN')),
  find: async () => Promise.reject(new Error('REDIS_DOWN')),
  remove: async () => Promise.reject(new Error('REDIS_DOWN')),
  list: async () => Promise.reject(new Error('REDIS_DOWN')),
  recordTraffic: async () => Promise.reject(new Error('REDIS_DOWN')),
  traffic: async () => Promise.reject(new Error('REDIS_DOWN')),
  close: async () => undefined,
};

describe('presence store', () => {
  it('degrades to memory when Redis operations fail', async () => {
    const store = new ResilientPresenceStore(
      failingStore,
      new MemoryPresenceStore(),
    );
    const item = session('50000000-0000-4000-8000-000000000001');
    await store.save(item);
    await store.recordTraffic(Date.now(), item.id);
    expect(await store.find(item.id)).toEqual(item);
    expect(await store.list()).toEqual([item]);
    expect((await store.traffic(0))[0]?.count).toBe(1);
  });

  it.runIf(Boolean(process.env.PRESENCE_REDIS_TEST_URL))(
    'shares latest point across instances with a short TTL',
    async () => {
      const url = process.env.PRESENCE_REDIS_TEST_URL!;
      const writer = new RedisPresenceStore(url);
      const reader = new RedisPresenceStore(url);
      const inspector = createClient({ url });
      const id = '50000000-0000-4000-8000-000000000002';
      try {
        await Promise.all([
          writer.connect(),
          reader.connect(),
          inspector.connect(),
        ]);
        await writer.save(session(id, 1));
        await writer.save({ ...session(id, 2), latitude: 10.788 });
        expect((await reader.find(id))?.lastSequence).toBe(2);
        expect(
          (await reader.list()).find((item) => item.id === id)?.latitude,
        ).toBe(10.788);
        const ttl = await inspector.ttl(`damsen:demo:presence:${id}`);
        expect(ttl).toBeGreaterThan(0);
        expect(ttl).toBeLessThanOrEqual(PRESENCE_TTL_SECONDS);
      } finally {
        await writer.remove(id).catch(() => undefined);
        await Promise.allSettled([
          writer.close(),
          reader.close(),
          inspector.isOpen ? inspector.quit() : Promise.resolve(),
        ]);
      }
    },
  );
});
