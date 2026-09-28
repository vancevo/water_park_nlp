import 'reflect-metadata';

import type { NestExpressApplication } from '@nestjs/platform-express';
import type { AuthResponse, UserRole } from '@damsen/shared-types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../src/bootstrap.js';
import {
  AUTH_REPOSITORY,
  type AuthRepository,
} from '../src/auth/auth.models.js';

async function jsonRequest(
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

describe('auth, RBAC and POI workflow HTTP API', () => {
  let app: NestExpressApplication;
  let baseUrl: string;
  let authRepository: AuthRepository;

  beforeAll(async () => {
    delete process.env.DATABASE_URL;
    app = await createApp();
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
    authRepository = app.get<AuthRepository>(AUTH_REPOSITORY);
  });

  afterAll(async () => app.close());

  async function account(
    email: string,
    roles: UserRole[],
  ): Promise<AuthResponse> {
    const response = await jsonRequest(baseUrl, '/v1/auth/register', {
      method: 'POST',
      body: {
        email,
        password: 'correct horse battery staple',
        preferredLocale: 'vi',
      },
    });
    expect(response.status).toBe(201);
    const auth = (await response.json()) as AuthResponse;
    // Test-only setup: production exposes no endpoint that can self-assign roles.
    await authRepository.setRoles(auth.user.id, roles);
    const login = await jsonRequest(baseUrl, '/v1/auth/login', {
      method: 'POST',
      body: { email, password: 'correct horse battery staple' },
    });
    return (await login.json()) as AuthResponse;
  }

  it('normalizes registration, rotates refresh tokens and revokes logout', async () => {
    const registered = await jsonRequest(baseUrl, '/v1/auth/register', {
      method: 'POST',
      body: {
        email: '  USER@Example.COM ',
        password: 'long-enough-password',
        preferredLocale: 'en',
      },
    });
    expect(registered.status).toBe(201);
    const first = (await registered.json()) as AuthResponse;
    expect(first.user.email).toBe('user@example.com');
    expect(first.user.roles).toEqual(['VISITOR']);

    const refreshed = await jsonRequest(baseUrl, '/v1/auth/refresh', {
      method: 'POST',
      body: { refreshToken: first.refreshToken },
    });
    expect(refreshed.status).toBe(200);
    const second = (await refreshed.json()) as AuthResponse;
    expect(second.refreshToken).not.toBe(first.refreshToken);

    const replay = await jsonRequest(baseUrl, '/v1/auth/refresh', {
      method: 'POST',
      body: { refreshToken: first.refreshToken },
    });
    expect(replay.status).toBe(401);

    const concurrent = await Promise.all([
      jsonRequest(baseUrl, '/v1/auth/refresh', {
        method: 'POST',
        body: { refreshToken: second.refreshToken },
      }),
      jsonRequest(baseUrl, '/v1/auth/refresh', {
        method: 'POST',
        body: { refreshToken: second.refreshToken },
      }),
    ]);
    expect(concurrent.map((response) => response.status).sort()).toEqual([
      200, 401,
    ]);
    const surviving = (await concurrent
      .find((response) => response.status === 200)!
      .json()) as AuthResponse;
    const logout = await jsonRequest(baseUrl, '/v1/auth/logout', {
      method: 'POST',
      body: { refreshToken: surviving.refreshToken },
    });
    expect(logout.status).toBe(204);
    const afterLogout = await jsonRequest(baseUrl, '/v1/auth/refresh', {
      method: 'POST',
      body: { refreshToken: surviving.refreshToken },
    });
    expect(afterLogout.status).toBe(401);
  }, 20_000);

  it('enforces roles and never leaks draft or pending content publicly', async () => {
    const visitor = await account('visitor@example.com', ['VISITOR']);
    const editor = await account('editor@example.com', ['EDITOR']);
    const reviewer = await account('reviewer@example.com', ['REVIEWER']);
    const input = {
      slug: 'test-discovery-place',
      category: 'exhibit',
      location: { latitude: 10.7671, longitude: 106.6351 },
      translations: [
        {
          locale: 'vi',
          name: 'Điểm thử',
          shortDescription: 'Mô tả thử',
          longDescription: 'Nội dung tiếng Việt.',
        },
        {
          locale: 'en',
          name: 'Test place',
          shortDescription: 'Test summary',
          longDescription: 'English content.',
        },
      ],
      entrances: [
        {
          labelVi: 'Cổng chính',
          labelEn: 'Main entrance',
          location: { latitude: 10.7671, longitude: 106.6351 },
          graphNodeRef: 'N1',
          isPrimary: true,
          accessibility: 'standard',
        },
      ],
      operatingHours: [{ dayOfWeek: 1, opensAt: '08:00', closesAt: '18:00' }],
    };

    const forbidden = await jsonRequest(baseUrl, '/v1/admin/pois', {
      method: 'POST',
      token: visitor.accessToken,
      body: input,
    });
    expect(forbidden.status).toBe(403);
    const createdResponse = await jsonRequest(baseUrl, '/v1/admin/pois', {
      method: 'POST',
      token: editor.accessToken,
      body: input,
    });
    expect(createdResponse.status).toBe(201);
    const created = (await createdResponse.json()) as { id: string };
    expect((await fetch(`${baseUrl}/v1/pois/${created.id}`)).status).toBe(404);

    const submittedResponse = await jsonRequest(
      baseUrl,
      `/v1/admin/pois/${created.id}/submit`,
      { method: 'POST', token: editor.accessToken },
    );
    expect(submittedResponse.status).toBe(200);
    const submitted = (await submittedResponse.json()) as {
      pendingVersionId: string;
    };
    expect((await fetch(`${baseUrl}/v1/pois/${created.id}`)).status).toBe(404);

    const editorApprove = await jsonRequest(
      baseUrl,
      `/v1/admin/content/${submitted.pendingVersionId}/approve`,
      { method: 'POST', token: editor.accessToken },
    );
    expect(editorApprove.status).toBe(403);
    const approved = await jsonRequest(
      baseUrl,
      `/v1/admin/content/${submitted.pendingVersionId}/approve`,
      { method: 'POST', token: reviewer.accessToken },
    );
    expect(approved.status).toBe(200);
    expect((await fetch(`${baseUrl}/v1/pois/${created.id}`)).status).toBe(200);
  }, 30_000);
});
