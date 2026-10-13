import { describe, expect, it } from 'vitest';

import { InMemoryOperationsRepository } from '../src/operations/in-memory-operations.repository.js';

describe('demo payment token security', () => {
  it('does not resolve guessed tokens and expires an old QR', async () => {
    const repository = new InMemoryOperationsRepository();
    const now = new Date('2026-10-11T10:00:00.000Z');
    const products = await repository.listTicketProducts();
    await repository.issueCustomerToken({
      tokenHash: 'customer-token-hash',
      actorId: '80000000-0000-4000-8000-000000000003',
      userId: '80000000-0000-4000-8000-000000000001',
      phoneMasked: '+84•••••1234',
      expiresAt: new Date(now.getTime() + 10 * 60_000),
      now,
    });
    const order = await repository.createOrder({
      id: '80000000-0000-4000-8000-000000000002',
      cashierId: '80000000-0000-4000-8000-000000000003',
      customerTokenHash: 'customer-token-hash',
      idempotencyKey: '80000000-0000-4000-8000-000000000004',
      items: [{ ticketProductId: products[0]!.id, quantity: 1 }],
      qrTokenHash: 'opaque-qr-token-hash',
      qrExpiresAt: new Date(now.getTime() + 5 * 60_000),
      qrUrl: 'http://localhost:3003/demo-pay/redacted',
      now,
    });

    expect(
      await repository.findOrderByQrToken('guessed-token', now),
    ).toBeNull();
    const expired = await repository.findOrderByQrToken(
      'opaque-qr-token-hash',
      new Date(now.getTime() + 5 * 60_000 + 1),
    );
    expect(expired).toMatchObject({ id: order.id, status: 'expired' });
    await expect(
      repository.beginSimulation(
        'opaque-qr-token-hash',
        '80000000-0000-4000-8000-000000000005',
        new Date(now.getTime() + 5 * 60_000 + 1),
      ),
    ).rejects.toThrow('PAYMENT_NOT_PENDING');
  });
});
