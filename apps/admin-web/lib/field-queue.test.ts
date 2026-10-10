import type { FieldCheckInput } from '@damsen/shared-types';
import { describe, expect, it } from 'vitest';
import {
  dismissQueued,
  enqueueCheck,
  flushQueue,
  readQueue,
} from './field-queue';

const memory = () => {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => void data.set(key, value),
  };
};
const input = (clientId: string): FieldCheckInput => ({
  clientId,
  target: 'poi',
  location: { latitude: 10.7, longitude: 106.6 },
  accuracyMeters: 6,
  sampleCount: 8,
  outcome: 'confirmed',
});
const apiError = (status: number) =>
  Object.assign(new Error(`HTTP ${status}`), { status });

describe('field queue', () => {
  it('keeps checks across reloads and replaces a re-saved clientId', () => {
    const store = memory();
    enqueueCheck('p1', input('a'), store);
    enqueueCheck('p1', input('b'), store);
    enqueueCheck('p1', { ...input('a'), outcome: 'corrected' }, store);
    const queued = readQueue(store);
    expect(queued.map((item) => item.input.clientId)).toEqual(['b', 'a']);
    expect(queued[1]?.input.outcome).toBe('corrected');
    expect(dismissQueued('b', store)).toHaveLength(1);
  });

  it('survives blocked storage', () => {
    const blocked = {
      getItem: () => {
        throw new Error('blocked');
      },
      setItem: () => {
        throw new Error('blocked');
      },
    };
    expect(readQueue(blocked)).toEqual([]);
    expect(() => enqueueCheck('p1', input('a'), blocked)).not.toThrow();
  });

  it('uploads oldest first and empties the queue', async () => {
    const store = memory();
    enqueueCheck('p1', input('a'), store);
    enqueueCheck('p2', input('b'), store);
    const order: string[] = [];
    const result = await flushQueue(async (poiId, body) => {
      order.push(`${poiId}:${body.clientId}`);
    }, store);
    expect(order).toEqual(['p1:a', 'p2:b']);
    expect(result).toEqual({ sent: 2, refused: 0, stillPending: 0 });
    expect(readQueue(store)).toEqual([]);
  });

  it('stops at the first network failure and keeps order for later', async () => {
    const store = memory();
    for (const id of ['a', 'b', 'c']) enqueueCheck('p1', input(id), store);
    let calls = 0;
    const result = await flushQueue(async () => {
      calls += 1;
      if (calls === 2) throw new TypeError('Failed to fetch');
    }, store);
    expect(result).toEqual({ sent: 1, refused: 0, stillPending: 2 });
    expect(readQueue(store).map((item) => item.input.clientId)).toEqual([
      'b',
      'c',
    ]);
  });

  it('keeps a refused check (not lost) but stops retrying it', async () => {
    const store = memory();
    enqueueCheck('p1', input('bad'), store);
    enqueueCheck('p1', input('good'), store);
    const send = async (_poiId: string, body: FieldCheckInput) => {
      if (body.clientId === 'bad') throw apiError(422);
    };
    const first = await flushQueue(send, store);
    expect(first).toEqual({ sent: 1, refused: 1, stillPending: 0 });
    const kept = readQueue(store);
    expect(kept).toHaveLength(1);
    expect(kept[0]?.failure).toContain('422');
    // A second flush does not hammer the server with the refused one.
    let called = 0;
    await flushQueue(async () => {
      called += 1;
    }, store);
    expect(called).toBe(0);
  });

  it('treats 401, 429 and 5xx as retryable', async () => {
    for (const status of [401, 429, 500, 503]) {
      const store = memory();
      enqueueCheck('p1', input('a'), store);
      const result = await flushQueue(async () => {
        throw apiError(status);
      }, store);
      expect(result.stillPending, String(status)).toBe(1);
      expect(readQueue(store)[0]?.failure).toBeUndefined();
    }
  });
});
