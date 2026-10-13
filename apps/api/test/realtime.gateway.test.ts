import 'reflect-metadata';

import type { NestExpressApplication } from '@nestjs/platform-express';
import type {
  AuthResponse,
  CashierCustomerLookup,
  DemoPaymentOrder,
  PresenceSession,
  RealtimeEvent,
  TicketProduct,
  VisitorPresencePoint,
} from '@damsen/shared-types';
import { io, type Socket } from 'socket.io-client';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../src/bootstrap.js';
import { TokenService } from '../src/auth/token.service.js';
import {
  AUTH_REPOSITORY,
  type AuthRepository,
} from '../src/auth/auth.models.js';

describe('authenticated realtime gateway', () => {
  let app: NestExpressApplication;
  let baseUrl: string;
  let repository: AuthRepository;
  const sockets: Socket[] = [];
  const previous = {
    databaseUrl: process.env.DATABASE_URL,
    demo: process.env.DEMO_MODE,
    phone: process.env.DEMO_PHONE_AUTH_ENABLED,
    payments: process.env.DEMO_PAYMENTS_ENABLED,
    delay: process.env.DEMO_PAYMENT_PROCESSING_DELAY_MS,
    redis: process.env.REALTIME_REDIS_ENABLED,
    redisUrl: process.env.REDIS_URL,
  };

  beforeAll(async () => {
    delete process.env.DATABASE_URL;
    process.env.DEMO_MODE = 'true';
    process.env.DEMO_PHONE_AUTH_ENABLED = 'true';
    process.env.DEMO_PAYMENTS_ENABLED = 'true';
    process.env.DEMO_PAYMENT_PROCESSING_DELAY_MS = '0';
    process.env.REALTIME_REDIS_ENABLED = process.env.PRESENCE_REDIS_TEST_URL
      ? 'true'
      : 'false';
    if (process.env.PRESENCE_REDIS_TEST_URL) {
      process.env.REDIS_URL = process.env.PRESENCE_REDIS_TEST_URL;
    }
    app = await createApp();
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
    repository = app.get<AuthRepository>(AUTH_REPOSITORY);
  });

  afterAll(async () => {
    for (const socket of sockets) socket.disconnect();
    await app.close();
    for (const [name, value] of Object.entries({
      DATABASE_URL: previous.databaseUrl,
      DEMO_MODE: previous.demo,
      DEMO_PHONE_AUTH_ENABLED: previous.phone,
      DEMO_PAYMENTS_ENABLED: previous.payments,
      DEMO_PAYMENT_PROCESSING_DELAY_MS: previous.delay,
      REALTIME_REDIS_ENABLED: previous.redis,
      REDIS_URL: previous.redisUrl,
    })) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  const api = async <T>(
    path: string,
    options: { method?: string; token?: string; body?: unknown } = {},
  ): Promise<T> => {
    const response = await fetch(`${baseUrl}${path}`, {
      method: options.method ?? 'GET',
      headers: {
        ...(options.body ? { 'content-type': 'application/json' } : {}),
        ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
      },
      ...(options.body ? { body: JSON.stringify(options.body) } : {}),
    });
    expect(response.ok).toBe(true);
    return (await response.json()) as T;
  };

  const connect = (token: string): Promise<Socket> =>
    new Promise((resolve, reject) => {
      const socket = io(`${baseUrl}/realtime`, {
        auth: { token },
        transports: ['websocket'],
        reconnection: false,
      });
      sockets.push(socket);
      socket.once('connect', () => resolve(socket));
      socket.once('connect_error', reject);
    });

  it('authorizes rooms and delivers versioned payment and loyalty events', async () => {
    const initialStaff = await api<AuthResponse>('/v1/auth/register', {
      method: 'POST',
      body: {
        email: 'realtime-cashier@example.com',
        password: 'correct horse battery staple',
      },
    });
    await repository.setRoles(initialStaff.user.id, ['CASHIER', 'OPERATIONS']);
    const staff = await api<AuthResponse>('/v1/auth/login', {
      method: 'POST',
      body: {
        email: 'realtime-cashier@example.com',
        password: 'correct horse battery staple',
      },
    });
    const visitor = await api<AuthResponse>('/v1/demo-auth/phone-session', {
      method: 'POST',
      body: { phone: '0902223344' },
    });
    const products = await api<TicketProduct[]>('/v1/cashier/ticket-products', {
      token: staff.accessToken,
    });
    const customer = await api<CashierCustomerLookup>(
      '/v1/cashier/customer-lookups',
      {
        method: 'POST',
        token: staff.accessToken,
        body: { phone: '0902223344' },
      },
    );
    const order = await api<DemoPaymentOrder>('/v1/cashier/payment-orders', {
      method: 'POST',
      token: staff.accessToken,
      body: {
        customerToken: customer.customerToken,
        idempotencyKey: '40000000-0000-4000-8000-000000000001',
        items: [{ ticketProductId: products[0]!.id, quantity: 1 }],
      },
    });

    const cashierSocket = await connect(staff.accessToken);
    const visitorSocket = await connect(visitor.accessToken);
    const cashierAck = await cashierSocket
      .timeout(1_000)
      .emitWithAck('order.subscribe.v1', { orderId: order.id });
    expect(cashierAck).toEqual({ ok: true });
    const forbiddenAck = await visitorSocket
      .timeout(1_000)
      .emitWithAck('order.subscribe.v1', { orderId: order.id });
    expect(forbiddenAck).toEqual({ ok: false, code: 'FORBIDDEN' });

    const presence = await api<PresenceSession>('/v1/me/presence/sessions', {
      method: 'POST',
      token: visitor.accessToken,
      body: {
        consentVersion: 'realtime-visitor-v1',
        shareIdentity: false,
        visibleToVisitors: true,
        locationMode: 'simulated',
      },
    });
    const visitorPresenceEvent = new Promise<RealtimeEvent>((resolve) => {
      visitorSocket.once('visitor.presence.delta.v1', resolve);
    });
    const locationResponse = await fetch(
      `${baseUrl}/v1/me/presence/sessions/${presence.id}/locations`,
      {
        method: 'POST',
        headers: {
          authorization: `Bearer ${visitor.accessToken}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          sessionId: presence.id,
          sequence: 1,
          latitude: 10.7658059,
          longitude: 106.6416272,
          accuracyMeters: 12,
          occurredAt: new Date().toISOString(),
        }),
      },
    );
    expect(locationResponse.status).toBe(204);
    const visitorPresence = await visitorPresenceEvent;
    expect(visitorPresence.type).toBe('visitor.presence.delta.v1');
    expect(visitorPresence.payload as VisitorPresencePoint).toEqual({
      presenceId: presence.id,
      pseudonym: presence.pseudonym,
      avatarVariant: presence.avatarVariant,
      latitude: 10.7658059,
      longitude: 106.6416272,
      locationMode: 'simulated',
      updatedAt: expect.any(String),
    });
    expect(JSON.stringify(visitorPresence.payload)).not.toMatch(
      /userId|phone|hasPaidTicket|destinationPoiId/,
    );

    const paymentEvent = new Promise<RealtimeEvent>((resolve) => {
      cashierSocket.on('payment.status.v1', (event: RealtimeEvent) => {
        if ((event.payload as DemoPaymentOrder).status === 'succeeded') {
          resolve(event);
        }
      });
    });
    const loyaltyEvent = new Promise<RealtimeEvent>((resolve) => {
      visitorSocket.once('loyalty.balance_changed.v1', resolve);
    });
    const qrToken = order.qrUrl!.split('/').at(-1)!;
    await api(`/v1/demo-payments/${qrToken}/confirm`, {
      method: 'POST',
      body: { idempotencyKey: '40000000-0000-4000-8000-000000000002' },
    });

    const [payment, loyalty] = await Promise.all([paymentEvent, loyaltyEvent]);
    expect(payment.schemaVersion).toBe(1);
    expect(payment.sequence).toBeGreaterThan(0);
    expect(payment.eventId).toMatch(/^[0-9a-f-]{36}$/);
    expect(loyalty.type).toBe('loyalty.balance_changed.v1');
    expect((loyalty.payload as { balance: number }).balance).toBe(
      products[0]!.pointsPerItem,
    );
  });

  it('disconnects a socket whose access token is already expired', async () => {
    const tokens = app.get(TokenService);
    const expired = tokens.issueAccess(
      { userId: '70000000-0000-4000-8000-000000000001', roles: ['VISITOR'] },
      new Date(Date.now() - (tokens.accessTokenExpiresIn + 1) * 1_000),
    );
    const socket = io(`${baseUrl}/realtime`, {
      auth: { token: expired },
      transports: ['websocket'],
      reconnection: false,
    });
    sockets.push(socket);
    const reason = await new Promise<string>((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('expired socket was not disconnected')),
        1_000,
      );
      socket.once('disconnect', (value) => {
        clearTimeout(timer);
        resolve(value);
      });
      socket.once('connect_error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
    expect(reason).toBe('io server disconnect');
  });
});
