import 'reflect-metadata';

import type { NestExpressApplication } from '@nestjs/platform-express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { TokenService } from '../src/auth/token.service.js';
import { createApp } from '../src/bootstrap.js';

const anonymousSessionId = '10000000-0000-4000-8000-000000000001';
const poiId = '00000000-0000-4000-8000-000000000101';

function batch(
  eventId = '20000000-0000-4000-8000-000000000001',
  payload: Record<string, unknown> = { poiId },
) {
  return {
    anonymousSessionId,
    consent: { analytics: true, policyVersion: 'privacy-v1' },
    events: [
      {
        eventId,
        schemaVersion: 1,
        eventType: 'poi_viewed',
        occurredAt: new Date().toISOString(),
        payload,
      },
    ],
  };
}

describe('privacy-safe analytics HTTP API', () => {
  let app: NestExpressApplication;
  let baseUrl: string;

  beforeAll(async () => {
    delete process.env.DATABASE_URL;
    app = await createApp();
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
  });

  afterAll(async () => app.close());

  async function post(body: unknown, authorization?: string) {
    return fetch(`${baseUrl}/v1/events/batch`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(authorization ? { authorization } : {}),
      },
      body: JSON.stringify(body),
    });
  }

  it('accepts an anonymous consented batch and makes retries idempotent', async () => {
    const first = await post(batch());
    expect(first.status).toBe(201);
    expect(await first.json()).toEqual({
      acceptedEventIds: ['20000000-0000-4000-8000-000000000001'],
      duplicateEventIds: [],
    });

    const retry = await post(batch());
    expect(retry.status).toBe(201);
    expect(await retry.json()).toEqual({
      acceptedEventIds: [],
      duplicateEventIds: ['20000000-0000-4000-8000-000000000001'],
    });
  });

  it('uses authenticated identity without requiring an anonymous identifier', async () => {
    const token = app.get(TokenService).issueAccess(
      {
        userId: '30000000-0000-4000-8000-000000000001',
        roles: ['VISITOR'],
      },
      new Date(),
    );
    const body = batch('20000000-0000-4000-8000-000000000002');
    Reflect.deleteProperty(body, 'anonymousSessionId');
    const response = await post(body, `Bearer ${token}`);
    expect(response.status).toBe(201);
  });

  it.each([
    ['raw GPS', { poiId, lat: 10.767, lng: 106.634 }],
    ['GPS trail', { poiId, gps_trail: [[10.767, 106.634]] }],
    ['PII-like email', { poiId, email: 'visitor@example.test' }],
  ])('rejects forbidden %s fields', async (_label, payload) => {
    const response = await post(
      batch('20000000-0000-4000-8000-000000000003', payload),
    );
    const body = (await response.json()) as { code: string };
    expect(response.status).toBe(400);
    expect(body.code).toBe('ANALYTICS_FORBIDDEN_DATA');
  });

  it('requires identity, affirmative consent and bounded batches', async () => {
    const missingIdentity = batch('20000000-0000-4000-8000-000000000004');
    Reflect.deleteProperty(missingIdentity, 'anonymousSessionId');
    expect((await post(missingIdentity)).status).toBe(400);

    const noConsent = batch('20000000-0000-4000-8000-000000000005');
    noConsent.consent.analytics = false as true;
    expect((await post(noConsent)).status).toBe(400);

    const oversized = batch('20000000-0000-4000-8000-000000000006');
    oversized.events = Array.from({ length: 51 }, (_, index) => ({
      ...oversized.events[0]!,
      eventId: `20000000-0000-4000-8000-${String(index).padStart(12, '0')}`,
    }));
    expect((await post(oversized)).status).toBe(400);
  });
});
