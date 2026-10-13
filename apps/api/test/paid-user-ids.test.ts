import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { dashboardRanges } from '../src/operations/dashboard-time.js';
import { InMemoryOperationsRepository } from '../src/operations/in-memory-operations.repository.js';

async function addSucceededOrder(
  repository: InMemoryOperationsRepository,
  userId: string,
  paidAt: Date,
) {
  const tokenHash = randomUUID();
  const qrTokenHash = randomUUID();
  const orderId = randomUUID();
  await repository.issueCustomerToken({
    tokenHash,
    actorId: randomUUID(),
    userId,
    phoneMasked: '+84•••••0000',
    expiresAt: new Date(paidAt.getTime() + 60_000),
    now: new Date(paidAt.getTime() - 2_000),
  });
  await repository.createOrder({
    id: orderId,
    cashierId: randomUUID(),
    customerTokenHash: tokenHash,
    idempotencyKey: randomUUID(),
    items: [
      {
        ticketProductId: '20000000-0000-4000-8000-000000000001',
        quantity: 1,
      },
    ],
    qrTokenHash,
    qrExpiresAt: new Date(paidAt.getTime() + 60_000),
    qrUrl: 'http://localhost:3003/demo-token',
    now: new Date(paidAt.getTime() - 1_000),
  });
  await repository.beginSimulation(qrTokenHash, randomUUID(), paidAt);
  await repository.completeSimulation(orderId, randomUUID(), paidAt);
}

describe('paid visitor lookup', () => {
  it('returns only users with a succeeded order in the current Vietnam day', async () => {
    const repository = new InMemoryOperationsRepository();
    const yesterdayUser = randomUUID();
    const todayUser = randomUUID();
    await addSucceededOrder(
      repository,
      yesterdayUser,
      new Date('2026-10-12T16:59:59.000Z'),
    );
    await addSucceededOrder(
      repository,
      todayUser,
      new Date('2026-10-12T17:00:00.000Z'),
    );

    const paidUsers = await repository.findPaidUserIds(
      [yesterdayUser, todayUser],
      dashboardRanges(new Date('2026-10-12T17:15:00.000Z')).today,
    );

    expect([...paidUsers]).toEqual([todayUser]);
  });
});
