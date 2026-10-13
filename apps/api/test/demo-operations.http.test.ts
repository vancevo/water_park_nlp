import 'reflect-metadata';

import type { NestExpressApplication } from '@nestjs/platform-express';
import type {
  AuthResponse,
  CashierCustomerLookup,
  DashboardSummary,
  DemoPaymentOrder,
  LoyaltyAccountSummary,
  RewardCatalogItem,
  TicketProduct,
  PresenceSession,
  AdminPresenceSnapshot,
  AdminPaymentFeedResponse,
  DashboardTraffic,
  VisitorPresenceSnapshot,
} from '@damsen/shared-types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../src/bootstrap.js';
import {
  AUTH_REPOSITORY,
  type AuthRepository,
} from '../src/auth/auth.models.js';

async function request(
  baseUrl: string,
  path: string,
  options: { method?: string; token?: string; body?: unknown } = {},
) {
  return fetch(`${baseUrl}${path}`, {
    method: options.method ?? 'GET',
    headers: {
      ...(options.body === undefined
        ? {}
        : { 'content-type': 'application/json' }),
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
    },
    ...(options.body === undefined
      ? {}
      : { body: JSON.stringify(options.body) }),
  });
}

describe('demo phone, payment, loyalty and dashboard HTTP vertical slice', () => {
  let app: NestExpressApplication;
  let baseUrl: string;
  let authRepository: AuthRepository;
  const previous = {
    databaseUrl: process.env.DATABASE_URL,
    demo: process.env.DEMO_MODE,
    phone: process.env.DEMO_PHONE_AUTH_ENABLED,
    payments: process.env.DEMO_PAYMENTS_ENABLED,
    delay: process.env.DEMO_PAYMENT_PROCESSING_DELAY_MS,
    openHour: process.env.OPERATIONS_OPEN_HOUR,
    closeHour: process.env.OPERATIONS_CLOSE_HOUR,
  };

  beforeAll(async () => {
    const testDatabaseUrl = process.env.DEMO_OPERATIONS_TEST_DATABASE_URL;
    if (testDatabaseUrl) process.env.DATABASE_URL = testDatabaseUrl;
    else delete process.env.DATABASE_URL;
    process.env.DEMO_MODE = 'true';
    process.env.DEMO_PHONE_AUTH_ENABLED = 'true';
    process.env.DEMO_PAYMENTS_ENABLED = 'true';
    process.env.DEMO_PAYMENT_PROCESSING_DELAY_MS = '150';
    process.env.OPERATIONS_OPEN_HOUR = '0';
    process.env.OPERATIONS_CLOSE_HOUR = '24';
    app = await createApp();
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
    authRepository = app.get<AuthRepository>(AUTH_REPOSITORY);
  });

  afterAll(async () => {
    await app.close();
    const restore = (name: string, value: string | undefined) => {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    };
    restore('DEMO_MODE', previous.demo);
    restore('DEMO_PHONE_AUTH_ENABLED', previous.phone);
    restore('DEMO_PAYMENTS_ENABLED', previous.payments);
    restore('DEMO_PAYMENT_PROCESSING_DELAY_MS', previous.delay);
    restore('OPERATIONS_OPEN_HOUR', previous.openHour);
    restore('OPERATIONS_CLOSE_HOUR', previous.closeHour);
    restore('DATABASE_URL', previous.databaseUrl);
  });

  async function createStaff(): Promise<AuthResponse> {
    const registered = await request(baseUrl, '/v1/auth/register', {
      method: 'POST',
      body: {
        email: 'cashier@example.com',
        password: 'correct horse battery staple',
      },
    });
    const initial = (await registered.json()) as AuthResponse;
    await authRepository.setRoles(initial.user.id, [
      'CASHIER',
      'OPERATIONS',
      'ADMIN',
    ]);
    const login = await request(baseUrl, '/v1/auth/login', {
      method: 'POST',
      body: {
        email: 'cashier@example.com',
        password: 'correct horse battery staple',
      },
    });
    return (await login.json()) as AuthResponse;
  }

  it('opens the same synthetic phone account without OTP', async () => {
    const first = await request(baseUrl, '/v1/demo-auth/phone-session', {
      method: 'POST',
      body: { phone: '0901 234 567' },
    });
    expect(first.status).toBe(200);
    const a = (await first.json()) as AuthResponse;
    expect(a.user.email).toBeUndefined();
    expect(a.user.phoneMasked).toContain('4567');
    expect(a.user.authMethods).toEqual(['demo_phone']);

    const second = await request(baseUrl, '/v1/demo-auth/phone-session', {
      method: 'POST',
      body: { phone: '+84901234567' },
    });
    const b = (await second.json()) as AuthResponse;
    expect(b.user.id).toBe(a.user.id);
    expect(Object.keys(b).sort()).toEqual(Object.keys(a).sort());
    expect(Object.keys(b.user).sort()).toEqual(Object.keys(a.user).sort());
    expect(JSON.stringify(b)).not.toContain('0901234567');

    let limited: Response | undefined;
    for (let attempt = 0; attempt < 11; attempt += 1) {
      limited = await request(baseUrl, '/v1/demo-auth/phone-session', {
        method: 'POST',
        body: { phone: '0909999999' },
      });
    }
    expect(limited?.status).toBe(429);
  });

  it('runs QR simulation, credits once, redeems once and reports revenue', async () => {
    const staff = await createStaff();
    const visitorResponse = await request(
      baseUrl,
      '/v1/demo-auth/phone-session',
      { method: 'POST', body: { phone: '0901234567' } },
    );
    const visitor = (await visitorResponse.json()) as AuthResponse;

    const loginPresenceResponse = await request(
      baseUrl,
      '/v1/me/presence/sessions',
      {
        method: 'POST',
        token: visitor.accessToken,
        body: {
          consentVersion: 'demo-login-synthetic-v1',
          shareIdentity: false,
          visibleToVisitors: true,
          locationMode: 'simulated',
        },
      },
    );
    const loginPresence =
      (await loginPresenceResponse.json()) as PresenceSession;
    await request(
      baseUrl,
      `/v1/me/presence/sessions/${loginPresence.id}/locations`,
      {
        method: 'POST',
        token: visitor.accessToken,
        body: {
          sessionId: loginPresence.id,
          sequence: 1,
          latitude: 10.7658059,
          longitude: 106.6416272,
          accuracyMeters: 12,
          occurredAt: new Date().toISOString(),
        },
      },
    );
    const beforePaymentPresence = (await (
      await request(baseUrl, '/v1/admin/presence', {
        token: staff.accessToken,
      })
    ).json()) as AdminPresenceSnapshot;
    expect(beforePaymentPresence.items).toHaveLength(1);
    expect(beforePaymentPresence.items[0]?.hasPaidTicket).toBe(false);
    const publicLoginPresence = (await (
      await request(baseUrl, '/v1/me/nearby-presence', {
        token: visitor.accessToken,
      })
    ).json()) as VisitorPresenceSnapshot;
    expect(publicLoginPresence.items).toHaveLength(1);
    expect(publicLoginPresence.items[0]).toEqual({
      presenceId: loginPresence.id,
      pseudonym: loginPresence.pseudonym,
      avatarVariant: loginPresence.avatarVariant,
      latitude: 10.7658059,
      longitude: 106.6416272,
      locationMode: 'simulated',
      updatedAt: expect.any(String),
    });
    const serializedPublicPresence = JSON.stringify(publicLoginPresence);
    expect(serializedPublicPresence).not.toContain(visitor.user.id);
    expect(serializedPublicPresence).not.toContain('0901234567');
    expect(serializedPublicPresence).not.toContain('hasPaidTicket');
    expect(serializedPublicPresence).not.toContain('destinationPoiId');
    expect((await request(baseUrl, '/v1/me/nearby-presence')).status).toBe(401);
    await request(baseUrl, `/v1/me/presence/sessions/${loginPresence.id}`, {
      method: 'DELETE',
      token: visitor.accessToken,
    });

    const forbidden = await request(baseUrl, '/v1/cashier/ticket-products', {
      token: visitor.accessToken,
    });
    expect(forbidden.status).toBe(403);

    const productsResponse = await request(
      baseUrl,
      '/v1/cashier/ticket-products',
      { token: staff.accessToken },
    );
    expect(productsResponse.status).toBe(200);
    const products = (await productsResponse.json()) as TicketProduct[];
    const product =
      products.find((candidate) => candidate.code === 'DEMO_ADULT') ??
      products[0]!;

    const lookupResponse = await request(
      baseUrl,
      '/v1/cashier/customer-lookups',
      {
        method: 'POST',
        token: staff.accessToken,
        body: { phone: '0901234567' },
      },
    );
    const customer = (await lookupResponse.json()) as CashierCustomerLookup;
    expect(customer.userId).toBe(visitor.user.id);

    const orderResponse = await request(baseUrl, '/v1/cashier/payment-orders', {
      method: 'POST',
      token: staff.accessToken,
      body: {
        customerToken: customer.customerToken,
        idempotencyKey: '30000000-0000-4000-8000-000000000001',
        items: [{ ticketProductId: product.id, quantity: 1 }],
      },
    });
    expect(orderResponse.status).toBe(201);
    const order = (await orderResponse.json()) as DemoPaymentOrder;
    expect(order.status).toBe('pending');
    const qrToken = order.qrUrl!.split('/').at(-1)!;

    const publicOrderResponse = await request(
      baseUrl,
      `/v1/demo-payments/${qrToken}`,
    );
    const publicOrder = (await publicOrderResponse.json()) as DemoPaymentOrder;
    expect(publicOrder.phoneMasked).toContain('4567');
    expect(JSON.stringify(publicOrder)).not.toContain('0901234567');

    const confirmBody = {
      idempotencyKey: '30000000-0000-4000-8000-000000000002',
    };
    const confirmationRequests = [
      request(baseUrl, `/v1/demo-payments/${qrToken}/confirm`, {
        method: 'POST',
        body: confirmBody,
      }),
      request(baseUrl, `/v1/demo-payments/${qrToken}/confirm`, {
        method: 'POST',
        body: confirmBody,
      }),
    ] as const;
    let observedProcessing = false;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      const duringSimulation = (await (
        await request(baseUrl, `/v1/demo-payments/${qrToken}`)
      ).json()) as DemoPaymentOrder;
      if (duringSimulation.status === 'processing') {
        observedProcessing = true;
        break;
      }
    }
    expect(observedProcessing).toBe(true);
    const [confirmedResponse, replay] = await Promise.all(confirmationRequests);
    expect(confirmedResponse.status).toBe(200);
    expect(replay.status).toBe(200);
    const confirmed = (await confirmedResponse.json()) as DemoPaymentOrder;
    expect(confirmed.status).toBe('succeeded');
    const consumedReplay = await request(
      baseUrl,
      `/v1/demo-payments/${qrToken}/confirm`,
      {
        method: 'POST',
        body: {
          idempotencyKey: '30000000-0000-4000-8000-000000000012',
        },
      },
    );
    expect(consumedReplay.status).toBe(409);

    const loyaltyResponse = await request(baseUrl, '/v1/me/loyalty', {
      token: visitor.accessToken,
    });
    const loyalty = (await loyaltyResponse.json()) as LoyaltyAccountSummary;
    expect(loyalty.balance).toBe(product.pointsPerItem);
    expect(loyalty.entries).toHaveLength(1);

    const rewardsResponse = await request(baseUrl, '/v1/rewards');
    const rewards = (await rewardsResponse.json()) as RewardCatalogItem[];
    const redemptionKey = '30000000-0000-4000-8000-000000000003';
    const redeem = await request(baseUrl, '/v1/me/reward-redemptions', {
      method: 'POST',
      token: visitor.accessToken,
      body: { rewardId: rewards[0]!.id, idempotencyKey: redemptionKey },
    });
    expect(redeem.status).toBe(201);
    const replayRedeem = await request(baseUrl, '/v1/me/reward-redemptions', {
      method: 'POST',
      token: visitor.accessToken,
      body: { rewardId: rewards[0]!.id, idempotencyKey: redemptionKey },
    });
    expect(replayRedeem.status).toBe(201);
    const afterRedeem = (await (
      await request(baseUrl, '/v1/me/loyalty', {
        token: visitor.accessToken,
      })
    ).json()) as LoyaltyAccountSummary;
    expect(afterRedeem.balance).toBe(
      product.pointsPerItem - rewards[0]!.pointsCost,
    );
    expect(afterRedeem.entries).toHaveLength(2);

    const concurrentRedemptions = await Promise.all([
      request(baseUrl, '/v1/me/reward-redemptions', {
        method: 'POST',
        token: visitor.accessToken,
        body: {
          rewardId: rewards[0]!.id,
          idempotencyKey: '30000000-0000-4000-8000-000000000004',
        },
      }),
      request(baseUrl, '/v1/me/reward-redemptions', {
        method: 'POST',
        token: visitor.accessToken,
        body: {
          rewardId: rewards[0]!.id,
          idempotencyKey: '30000000-0000-4000-8000-000000000005',
        },
      }),
    ]);
    expect(
      concurrentRedemptions.map((response) => response.status).sort(),
    ).toEqual([201, 409]);
    const afterConcurrent = (await (
      await request(baseUrl, '/v1/me/loyalty', {
        token: visitor.accessToken,
      })
    ).json()) as LoyaltyAccountSummary;
    expect(afterConcurrent.balance).toBe(0);
    expect(afterConcurrent.entries).toHaveLength(3);

    const visitorAdjustment = await request(
      baseUrl,
      '/v1/admin/loyalty-adjustments',
      {
        method: 'POST',
        token: visitor.accessToken,
        body: {
          userId: visitor.user.id,
          delta: 150,
          reason: 'Demo service recovery',
          idempotencyKey: '30000000-0000-4000-8000-000000000010',
        },
      },
    );
    expect(visitorAdjustment.status).toBe(403);
    const adjustmentBody = {
      userId: visitor.user.id,
      delta: 150,
      reason: 'Demo service recovery',
      idempotencyKey: '30000000-0000-4000-8000-000000000010',
    };
    const adjustedResponse = await request(
      baseUrl,
      '/v1/admin/loyalty-adjustments',
      { method: 'POST', token: staff.accessToken, body: adjustmentBody },
    );
    expect(adjustedResponse.status).toBe(200);
    const adjusted = (await adjustedResponse.json()) as LoyaltyAccountSummary;
    expect(adjusted.balance).toBe(150);
    expect(adjusted.entries[0]).toMatchObject({
      delta: 150,
      entryType: 'admin_adjustment',
      description: 'Demo service recovery',
      balanceAfter: 150,
    });
    const replayAdjustment = await request(
      baseUrl,
      '/v1/admin/loyalty-adjustments',
      { method: 'POST', token: staff.accessToken, body: adjustmentBody },
    );
    expect(
      ((await replayAdjustment.json()) as LoyaltyAccountSummary).balance,
    ).toBe(150);
    const invalidDebit = await request(
      baseUrl,
      '/v1/admin/loyalty-adjustments',
      {
        method: 'POST',
        token: staff.accessToken,
        body: {
          ...adjustmentBody,
          delta: -151,
          idempotencyKey: '30000000-0000-4000-8000-000000000011',
        },
      },
    );
    expect(invalidDebit.status).toBe(409);

    const dashboardResponse = await request(
      baseUrl,
      '/v1/admin/dashboard/summary',
      { token: staff.accessToken },
    );
    expect(dashboardResponse.status).toBe(200);
    const dashboard = (await dashboardResponse.json()) as DashboardSummary;
    expect(dashboard.simulatedRevenue.todayVnd).toBe(product.amountVnd);
    expect(dashboard.payingUsersToday).toBe(1);

    const secondLookup = (await (
      await request(baseUrl, '/v1/cashier/customer-lookups', {
        method: 'POST',
        token: staff.accessToken,
        body: { phone: '0901234567' },
      })
    ).json()) as CashierCustomerLookup;
    const secondOrderResponse = await request(
      baseUrl,
      '/v1/cashier/payment-orders',
      {
        method: 'POST',
        token: staff.accessToken,
        body: {
          customerToken: secondLookup.customerToken,
          idempotencyKey: '30000000-0000-4000-8000-000000000006',
          items: [{ ticketProductId: product.id, quantity: 2 }],
        },
      },
    );
    expect(secondOrderResponse.status).toBe(201);
    const secondOrder = (await secondOrderResponse.json()) as DemoPaymentOrder;

    const firstFeedResponse = await request(
      baseUrl,
      '/v1/admin/dashboard/recent-payments?limit=1',
      { token: staff.accessToken },
    );
    expect(firstFeedResponse.status).toBe(200);
    const firstFeed =
      (await firstFeedResponse.json()) as AdminPaymentFeedResponse;
    expect(firstFeed.items).toHaveLength(1);
    expect(firstFeed.items[0]).toMatchObject({
      id: secondOrder.id,
      phoneMasked: visitor.user.phoneMasked,
      ticketQuantity: 2,
      status: 'pending',
    });
    expect(firstFeed.nextCursor).toBeTruthy();
    const secondFeed = (await (
      await request(
        baseUrl,
        `/v1/admin/dashboard/recent-payments?limit=1&cursor=${encodeURIComponent(firstFeed.nextCursor!)}`,
        { token: staff.accessToken },
      )
    ).json()) as AdminPaymentFeedResponse;
    expect(secondFeed.items).toHaveLength(1);
    expect(secondFeed.items[0]!.id).toBe(order.id);
    expect(secondFeed.items[0]!.status).toBe('succeeded');

    const visitorFeed = await request(
      baseUrl,
      '/v1/admin/dashboard/recent-payments',
      { token: visitor.accessToken },
    );
    expect(visitorFeed.status).toBe(403);
    const invalidCursor = await request(
      baseUrl,
      '/v1/admin/dashboard/recent-payments?cursor=invalid',
      { token: staff.accessToken },
    );
    expect(invalidCursor.status).toBe(400);

    const secondQrToken = secondOrder.qrUrl!.split('/').at(-1)!;
    const tamperedConfirm = await request(
      baseUrl,
      `/v1/demo-payments/${secondQrToken}/confirm`,
      {
        method: 'POST',
        body: {
          idempotencyKey: '30000000-0000-4000-8000-000000000013',
          amountVnd: 1,
        },
      },
    );
    expect(tamperedConfirm.status).toBe(400);
    const failedBody = {
      idempotencyKey: '30000000-0000-4000-8000-000000000014',
      simulateOutcome: 'failed',
    } as const;
    const failedResponse = await request(
      baseUrl,
      `/v1/demo-payments/${secondQrToken}/confirm`,
      { method: 'POST', body: failedBody },
    );
    expect(failedResponse.status).toBe(200);
    expect((await failedResponse.json()) as DemoPaymentOrder).toMatchObject({
      id: secondOrder.id,
      status: 'failed',
    });
    const failedReplay = await request(
      baseUrl,
      `/v1/demo-payments/${secondQrToken}/confirm`,
      { method: 'POST', body: failedBody },
    );
    expect(failedReplay.status).toBe(200);
    const afterFailure = (await (
      await request(baseUrl, '/v1/me/loyalty', {
        token: visitor.accessToken,
      })
    ).json()) as LoyaltyAccountSummary;
    expect(afterFailure.balance).toBe(150);
    expect(afterFailure.entries).toHaveLength(4);

    const presenceSessionIds: string[] = [];
    for (let index = 0; index < 3; index += 1) {
      const startResponse = await request(baseUrl, '/v1/me/presence/sessions', {
        method: 'POST',
        token: visitor.accessToken,
        body: {
          consentVersion: 'demo-v1',
          shareIdentity: false,
          visibleToVisitors: index === 0,
          locationMode: 'shared',
        },
      });
      expect(startResponse.status).toBe(201);
      const presenceSession = (await startResponse.json()) as PresenceSession;
      presenceSessionIds.push(presenceSession.id);
      const updateResponse = await request(
        baseUrl,
        `/v1/me/presence/sessions/${presenceSession.id}/locations`,
        {
          method: 'POST',
          token: visitor.accessToken,
          body: {
            sessionId: presenceSession.id,
            sequence: 1,
            latitude: 10.76433 + index * 0.00001,
            longitude: 106.63853,
            accuracyMeters: 8,
            occurredAt: new Date().toISOString(),
          },
        },
      );
      expect(updateResponse.status).toBe(204);
      if (index === 0) {
        const replay = await request(
          baseUrl,
          `/v1/me/presence/sessions/${presenceSession.id}/locations`,
          {
            method: 'POST',
            token: visitor.accessToken,
            body: {
              sessionId: presenceSession.id,
              sequence: 1,
              latitude: 10.765,
              longitude: 106.639,
              accuracyMeters: 8,
              occurredAt: new Date().toISOString(),
            },
          },
        );
        expect(replay.status).toBe(409);

        const rateAbuse = await request(
          baseUrl,
          `/v1/me/presence/sessions/${presenceSession.id}/locations`,
          {
            method: 'POST',
            token: visitor.accessToken,
            body: {
              sessionId: presenceSession.id,
              sequence: 2,
              latitude: 10.76434,
              longitude: 106.63853,
              accuracyMeters: 8,
              occurredAt: new Date().toISOString(),
            },
          },
        );
        expect(rateAbuse.status).toBe(429);

        const outsidePark = await request(
          baseUrl,
          `/v1/me/presence/sessions/${presenceSession.id}/locations`,
          {
            method: 'POST',
            token: visitor.accessToken,
            body: {
              sessionId: presenceSession.id,
              sequence: 2,
              latitude: 10.8,
              longitude: 106.7,
              accuracyMeters: 8,
              occurredAt: new Date().toISOString(),
            },
          },
        );
        expect(outsidePark.status).toBe(400);

        const weakGps = await request(
          baseUrl,
          `/v1/me/presence/sessions/${presenceSession.id}/locations`,
          {
            method: 'POST',
            token: visitor.accessToken,
            body: {
              sessionId: presenceSession.id,
              sequence: 2,
              latitude: 10.76434,
              longitude: 106.63853,
              accuracyMeters: 101,
              occurredAt: new Date().toISOString(),
            },
          },
        );
        expect(weakGps.status).toBe(400);
      }
    }

    const presenceResponse = await request(baseUrl, '/v1/admin/presence', {
      token: staff.accessToken,
    });
    const presence = (await presenceResponse.json()) as AdminPresenceSnapshot;
    expect(presence.items).toHaveLength(3);
    expect(presence.items.every((item) => item.hasPaidTicket)).toBe(true);
    expect(JSON.stringify(presence)).not.toContain('0901234567');
    const nearby = (await (
      await request(baseUrl, '/v1/me/nearby-presence', {
        token: visitor.accessToken,
      })
    ).json()) as VisitorPresenceSnapshot;
    expect(nearby.items).toHaveLength(1);
    expect(nearby.items[0]?.presenceId).toBe(presenceSessionIds[0]);
    expect(nearby.items[0]?.locationMode).toBe('shared');
    expect(nearby.items[0]?.latitude).not.toBe(10.76433);
    expect(nearby.items[0]?.longitude).not.toBe(106.63853);

    const trafficResponse = await request(
      baseUrl,
      '/v1/admin/dashboard/traffic',
      { token: staff.accessToken },
    );
    const traffic = (await trafficResponse.json()) as DashboardTraffic;
    expect(traffic.items.at(-1)?.uniqueVisitors).toBe(4);

    const visitorCannotReadPresence = await request(
      baseUrl,
      '/v1/admin/presence',
      { token: visitor.accessToken },
    );
    expect(visitorCannotReadPresence.status).toBe(403);

    const stopResponse = await request(
      baseUrl,
      `/v1/me/presence/sessions/${presenceSessionIds[0]}`,
      { method: 'DELETE', token: visitor.accessToken },
    );
    expect(stopResponse.status).toBe(204);
    const afterStop = (await (
      await request(baseUrl, '/v1/admin/presence', {
        token: staff.accessToken,
      })
    ).json()) as AdminPresenceSnapshot;
    expect(afterStop.items).toHaveLength(2);
    const nearbyAfterStop = (await (
      await request(baseUrl, '/v1/me/nearby-presence', {
        token: visitor.accessToken,
      })
    ).json()) as VisitorPresenceSnapshot;
    expect(nearbyAfterStop.items).toHaveLength(0);
  });
});
