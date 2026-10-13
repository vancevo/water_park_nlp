import { describe, expect, it, vi } from 'vitest';

import {
  OperationsOutboxRelay,
  type OutboxDatabase,
  type OutboxRealtimePublisher,
} from '../src/operations/outbox-relay.js';

describe('operations outbox worker relay', () => {
  it('publishes a versioned event to its private room and marks it sent', async () => {
    const query = vi
      .fn<OutboxDatabase['query']>()
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'event-1',
            event_type: 'payment.status.v1',
            aggregate_id: 'order-1',
            payload: { orderId: 'order-1', status: 'succeeded' },
            created_at: new Date('2026-10-12T00:00:00Z'),
            retry_count: 0,
          },
        ],
      })
      .mockResolvedValue({ rows: [] });
    const emit = vi.fn<OutboxRealtimePublisher['emit']>();
    const relay = new OperationsOutboxRelay(
      { query: query as unknown as OutboxDatabase['query'] },
      { nextSequence: async () => 7, emit },
    );

    await expect(relay.drain()).resolves.toEqual({ published: 1, failed: 0 });
    expect(emit).toHaveBeenCalledWith(
      'order:order-1',
      'payment.status.v1',
      expect.objectContaining({
        eventId: 'event-1',
        schemaVersion: 1,
        sequence: 7,
      }),
    );
    expect(query.mock.calls.at(-1)?.[1]).toEqual(['event-1']);
  });

  it('retries unsupported events without exposing payload data', async () => {
    const query = vi
      .fn<OutboxDatabase['query']>()
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'event-2',
            event_type: 'unsupported.v1',
            aggregate_id: 'aggregate-1',
            payload: { secret: 'not-logged' },
            created_at: new Date('2026-10-12T00:00:00Z'),
            retry_count: 9,
          },
        ],
      })
      .mockResolvedValue({ rows: [] });
    const relay = new OperationsOutboxRelay(
      { query: query as unknown as OutboxDatabase['query'] },
      { nextSequence: async () => 1, emit: vi.fn() },
    );

    await expect(relay.drain()).resolves.toEqual({ published: 0, failed: 1 });
    expect(query.mock.calls.at(-1)?.[1]).toEqual(['event-2', true]);
  });
});
