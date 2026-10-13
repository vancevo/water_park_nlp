import { describe, expect, it } from 'vitest';

import { geoDistanceMeters } from './route-simulation';
import {
  GATE_1_POINT,
  paidLedgerEntryIdToday,
  paidOrderId,
  simulatedGatePoint,
} from './payment-presence';

describe('post-payment presence helpers', () => {
  it('places distinct simulated visitors close to Gate 1', () => {
    const first = simulatedGatePoint('visitor-session-1');
    const second = simulatedGatePoint('visitor-session-2');

    expect(first).not.toEqual(second);
    expect(geoDistanceMeters(first, GATE_1_POINT)).toBeGreaterThanOrEqual(5.9);
    expect(geoDistanceMeters(first, GATE_1_POINT)).toBeLessThanOrEqual(18.1);
    expect(geoDistanceMeters(second, GATE_1_POINT)).toBeLessThanOrEqual(18.1);
  });

  it('only accepts a positive loyalty event tied to a payment order', () => {
    const base = {
      eventId: crypto.randomUUID(),
      schemaVersion: 1 as const,
      sequence: 1,
      occurredAt: new Date().toISOString(),
    };
    expect(
      paidOrderId({
        ...base,
        type: 'loyalty.balance_changed.v1',
        payload: { orderId: 'order-1', delta: 200 },
      }),
    ).toBe('order-1');
    expect(
      paidOrderId({
        ...base,
        type: 'loyalty.balance_changed.v1',
        payload: { delta: 200 },
      }),
    ).toBeNull();
    expect(
      paidOrderId({
        ...base,
        type: 'dashboard.delta.v1',
        payload: { orderId: 'order-1', delta: 200 },
      }),
    ).toBeNull();
  });

  it('finds only a payment credit from the current Vietnam day', () => {
    const entries = [
      {
        id: 'yesterday-payment',
        delta: 200,
        entryType: 'payment_credit' as const,
        description: 'Vé hôm qua',
        balanceAfter: 200,
        createdAt: '2026-10-12T16:59:59.000Z',
      },
      {
        id: 'today-adjustment',
        delta: 20,
        entryType: 'admin_adjustment' as const,
        description: 'Điều chỉnh',
        balanceAfter: 220,
        createdAt: '2026-10-12T17:01:00.000Z',
      },
      {
        id: 'today-payment',
        delta: 120,
        entryType: 'payment_credit' as const,
        description: 'Vé hôm nay',
        balanceAfter: 340,
        createdAt: '2026-10-12T17:05:00.000Z',
      },
    ];

    expect(
      paidLedgerEntryIdToday(entries, new Date('2026-10-12T17:15:00.000Z')),
    ).toBe('today-payment');
    expect(
      paidLedgerEntryIdToday(
        entries.slice(0, 2),
        new Date('2026-10-12T17:15:00.000Z'),
      ),
    ).toBeNull();
  });
});
