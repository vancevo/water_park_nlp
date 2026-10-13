import type { RealtimeEvent } from '@damsen/shared-types';
import { RealtimeInvalidationGate } from '@damsen/api-client';
import { describe, expect, it } from 'vitest';

const event = (sequence: number, eventId: string): RealtimeEvent => ({
  eventId,
  schemaVersion: 1,
  sequence,
  occurredAt: '2026-10-12T00:00:00.000Z',
  type: 'payment.status.v1',
  payload: { orderId: '30000000-0000-4000-8000-000000000001' },
});

describe('realtime invalidation ordering', () => {
  it('drops duplicate and out-of-order events', () => {
    const gate = new RealtimeInvalidationGate();
    expect(gate.accept(event(2, 'event-2'), 'order-1')).toBe(true);
    expect(gate.accept(event(2, 'event-2-duplicate'), 'order-1')).toBe(false);
    expect(gate.accept(event(1, 'event-1-late'), 'order-1')).toBe(false);
    expect(gate.accept(event(3, 'event-3'), 'order-1')).toBe(true);
  });

  it('resets sequence state when reconnect begins with a REST snapshot', () => {
    const gate = new RealtimeInvalidationGate();
    expect(gate.accept(event(9, 'before-restart'), 'order-1')).toBe(true);
    gate.reset();
    expect(gate.accept(event(1, 'after-restart'), 'order-1')).toBe(true);
  });
});
