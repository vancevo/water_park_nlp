import 'reflect-metadata';

import { randomUUID } from 'node:crypto';

import type { NestExpressApplication } from '@nestjs/platform-express';
import type {
  AdminPoi,
  AuthResponse,
  FieldCheck,
  UserRole,
} from '@damsen/shared-types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../src/bootstrap.js';
import {
  AUTH_REPOSITORY,
  type AuthRepository,
} from '../src/auth/auth.models.js';

const PASSWORD = 'correct horse battery staple';

describe('field verification HTTP API', () => {
  let app: NestExpressApplication;
  let baseUrl: string;
  let authRepository: AuthRepository;

  const call = (
    path: string,
    options: { method?: string; token?: string; body?: unknown } = {},
  ) =>
    fetch(`${baseUrl}${path}`, {
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

  async function account(email: string, roles: UserRole[]): Promise<string> {
    const registered = await call('/v1/auth/register', {
      method: 'POST',
      body: { email, password: PASSWORD, preferredLocale: 'vi' },
    });
    const auth = (await registered.json()) as AuthResponse;
    await authRepository.setRoles(auth.user.id, roles);
    const login = await call('/v1/auth/login', {
      method: 'POST',
      body: { email, password: PASSWORD },
    });
    return ((await login.json()) as AuthResponse).accessToken;
  }

  beforeAll(async () => {
    delete process.env.DATABASE_URL;
    app = await createApp();
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
    authRepository = app.get<AuthRepository>(AUTH_REPOSITORY);
  });
  afterAll(async () => app.close());

  async function publishedPoi(token: string): Promise<AdminPoi> {
    const list = (await (
      await call('/v1/admin/pois', { token })
    ).json()) as AdminPoi[];
    const poi = list.find((item) => item.status === 'published');
    expect(poi).toBeDefined();
    return poi!;
  }

  const body = (poi: AdminPoi, overrides: Record<string, unknown> = {}) => ({
    clientId: randomUUID(),
    target: 'poi',
    location: {
      latitude: poi.location.latitude + 0.0001,
      longitude: poi.location.longitude + 0.0001,
    },
    accuracyMeters: 6,
    sampleCount: 12,
    outcome: 'corrected',
    pathOk: true,
    note: ' đo ở cổng chính ',
    ...overrides,
  });

  it('records a check without touching the POI, and retries are idempotent', async () => {
    const editor = await account('field-editor@example.com', ['EDITOR']);
    const poi = await publishedPoi(editor);
    const payload = body(poi);

    const first = await call(`/v1/admin/pois/${poi.id}/field-checks`, {
      method: 'POST',
      token: editor,
      body: payload,
    });
    expect(first.status).toBe(201);
    const check = (await first.json()) as FieldCheck;
    expect(check.distanceFromCurrentMeters).toBeGreaterThan(10);
    expect(check.distanceFromCurrentMeters).toBeLessThan(20);
    expect(check.note).toBe('đo ở cổng chính');

    const retry = await call(`/v1/admin/pois/${poi.id}/field-checks`, {
      method: 'POST',
      token: editor,
      body: payload,
    });
    expect(retry.status).toBe(200);
    expect(((await retry.json()) as FieldCheck).id).toBe(check.id);

    const listed = (await (
      await call(`/v1/admin/field-checks?poiId=${poi.id}`, { token: editor })
    ).json()) as FieldCheck[];
    expect(
      listed.filter((item) => item.clientId === payload.clientId),
    ).toHaveLength(1);

    const after = await publishedPoi(editor);
    expect(after.id).toBe(poi.id);
    expect(after.location).toEqual(poi.location); // evidence only
  });

  it('refuses a fix worse than 50 m with a stable code', async () => {
    const editor = await account('field-editor2@example.com', ['EDITOR']);
    const poi = await publishedPoi(editor);
    const response = await call(`/v1/admin/pois/${poi.id}/field-checks`, {
      method: 'POST',
      token: editor,
      body: body(poi, { accuracyMeters: 80 }),
    });
    expect(response.status).toBe(422);
    expect(((await response.json()) as { code: string }).code).toBe(
      'FIELD_CHECK_ACCURACY_TOO_LOW',
    );
  });

  it('validates the target, the entrance and the body', async () => {
    const editor = await account('field-editor3@example.com', ['EDITOR']);
    const poi = await publishedPoi(editor);
    const url = `/v1/admin/pois/${poi.id}/field-checks`;
    const missingEntrance = await call(url, {
      method: 'POST',
      token: editor,
      body: body(poi, { target: 'entrance' }),
    });
    expect(missingEntrance.status).toBe(400);
    const unknownEntrance = await call(url, {
      method: 'POST',
      token: editor,
      body: body(poi, { target: 'entrance', entranceId: randomUUID() }),
    });
    expect(unknownEntrance.status).toBe(404);
    const junk = await call(url, {
      method: 'POST',
      token: editor,
      body: body(poi, { outcome: 'maybe', extra: true }),
    });
    expect(junk.status).toBe(400);
    const unknownPoi = await call(
      `/v1/admin/pois/${randomUUID()}/field-checks`,
      {
        method: 'POST',
        token: editor,
        body: body(poi),
      },
    );
    expect(unknownPoi.status).toBe(404);
  });

  it('only reviewers/admins apply a check, in place, keeping the place published', async () => {
    const editor = await account('field-editor4@example.com', ['EDITOR']);
    const reviewer = await account('field-reviewer@example.com', ['REVIEWER']);
    const visitor = await account('field-visitor@example.com', []);
    const poi = await publishedPoi(editor);
    const created = (await (
      await call(`/v1/admin/pois/${poi.id}/field-checks`, {
        method: 'POST',
        token: editor,
        body: body(poi),
      })
    ).json()) as FieldCheck;

    expect(
      (
        await call(`/v1/admin/field-checks/${created.id}/apply`, {
          method: 'POST',
          token: editor,
          body: {},
        })
      ).status,
    ).toBe(403);
    expect(
      (await call(`/v1/admin/field-checks?applied=false`, { token: visitor }))
        .status,
    ).toBe(403);

    const applied = await call(`/v1/admin/field-checks/${created.id}/apply`, {
      method: 'POST',
      token: reviewer,
      body: {},
    });
    expect(applied.status).toBe(200);
    const updated = (await applied.json()) as AdminPoi;
    expect(updated.status).toBe('published');
    expect(updated.location).toEqual(created.location);

    const again = await call(`/v1/admin/field-checks/${created.id}/apply`, {
      method: 'POST',
      token: reviewer,
      body: {},
    });
    expect(again.status).toBe(409);
    const open = (await (
      await call('/v1/admin/field-checks?applied=false', { token: reviewer })
    ).json()) as FieldCheck[];
    expect(open.find((item) => item.id === created.id)).toBeUndefined();

    const auditBody = (await (
      await call('/v1/admin/audit-logs', {
        token: await account('field-admin@example.com', ['ADMIN']),
      })
    ).json()) as
      | { action: string; entityId: string }[]
      | { items: { action: string; entityId: string }[] };
    const audit = Array.isArray(auditBody) ? auditBody : auditBody.items;
    expect(
      audit.some(
        (entry) =>
          entry.action === 'poi.location_corrected' &&
          entry.entityId === poi.id,
      ),
    ).toBe(true);
  });

  it('applies an entrance check only with the path node it snaps to', async () => {
    const editor = await account('field-editor5@example.com', ['EDITOR']);
    const reviewer = await account('field-reviewer2@example.com', ['REVIEWER']);
    const poi = await publishedPoi(editor);
    const entrance = poi.entrances[0]!;
    const created = (await (
      await call(`/v1/admin/pois/${poi.id}/field-checks`, {
        method: 'POST',
        token: editor,
        body: body(poi, {
          target: 'entrance',
          entranceId: entrance.id,
          location: {
            latitude: entrance.location.latitude + 0.00005,
            longitude: entrance.location.longitude,
          },
        }),
      })
    ).json()) as FieldCheck;

    const missingNode = await call(
      `/v1/admin/field-checks/${created.id}/apply`,
      {
        method: 'POST',
        token: reviewer,
        body: {},
      },
    );
    expect(missingNode.status).toBe(400);
    const ok = await call(`/v1/admin/field-checks/${created.id}/apply`, {
      method: 'POST',
      token: reviewer,
      body: { graphNodeRef: 'osm-123' },
    });
    expect(ok.status).toBe(200);
    const updated = (await ok.json()) as AdminPoi;
    const moved = updated.entrances.find((item) => item.id === entrance.id);
    expect(moved?.graphNodeRef).toBe('osm-123');
    expect(moved?.location).toEqual(created.location);
  });
});
