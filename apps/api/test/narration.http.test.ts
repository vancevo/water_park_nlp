import 'reflect-metadata';

import type { NestExpressApplication } from '@nestjs/platform-express';
import type {
  AdminNarration,
  AuthResponse,
  PoiNarration,
  UserRole,
} from '@damsen/shared-types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../src/bootstrap.js';
import {
  AUTH_REPOSITORY,
  type AuthRepository,
} from '../src/auth/auth.models.js';

const POI_ID = '00000000-0000-4000-8000-000000000101';

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

describe('multilingual narration HTTP API', () => {
  let app: NestExpressApplication;
  let baseUrl: string;
  let authRepository: AuthRepository;

  beforeAll(async () => {
    delete process.env.DATABASE_URL;
    process.env.S3_ENABLED = 'false';
    app = await createApp();
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
    authRepository = app.get<AuthRepository>(AUTH_REPOSITORY);
  });

  afterAll(async () => {
    delete process.env.S3_ENABLED;
    await app.close();
  });

  async function account(email: string, roles: UserRole[]) {
    const registered = await request(baseUrl, '/v1/auth/register', {
      method: 'POST',
      body: { email, password: 'correct horse battery staple' },
    });
    const initial = (await registered.json()) as AuthResponse;
    await authRepository.setRoles(initial.user.id, roles);
    const login = await request(baseUrl, '/v1/auth/login', {
      method: 'POST',
      body: { email, password: 'correct horse battery staple' },
    });
    return (await login.json()) as AuthResponse;
  }

  it('returns only the exact-locale published revision', async () => {
    const response = await request(
      baseUrl,
      `/v1/pois/${POI_ID}/narration?locale=en`,
    );
    expect(response.status).toBe(200);
    const narration = (await response.json()) as PoiNarration;
    expect(narration).toMatchObject({
      poiId: POI_ID,
      requestedLocale: 'en',
      resolvedLocale: 'en',
      fallbackUsed: false,
      audio: null,
    });
    expect(narration.transcript).toContain('field verification');
  });

  it('keeps drafts private and enforces editor/reviewer workflow', async () => {
    const visitor = await account('narration-visitor@example.com', ['VISITOR']);
    const editor = await account('narration-editor@example.com', ['EDITOR']);
    const reviewer = await account('narration-reviewer@example.com', [
      'REVIEWER',
    ]);

    const visitorCreate = await request(
      baseUrl,
      `/v1/admin/pois/${POI_ID}/narrations`,
      {
        method: 'POST',
        token: visitor.accessToken,
        body: {
          locale: 'en',
          transcript: 'This visitor must not be allowed to create narration.',
        },
      },
    );
    expect(visitorCreate.status).toBe(403);

    const before = (await (
      await request(baseUrl, `/v1/pois/${POI_ID}/narration?locale=en`)
    ).json()) as PoiNarration;
    const draftResponse = await request(
      baseUrl,
      `/v1/admin/pois/${POI_ID}/narrations`,
      {
        method: 'POST',
        token: editor.accessToken,
        body: {
          locale: 'en',
          transcript:
            'A revised synthetic English narration that remains private until review.',
        },
      },
    );
    expect(draftResponse.status).toBe(201);
    const draft = (await draftResponse.json()) as AdminNarration;
    expect(draft).toMatchObject({ status: 'draft', revision: 2 });

    const whileDraft = (await (
      await request(baseUrl, `/v1/pois/${POI_ID}/narration?locale=en`)
    ).json()) as PoiNarration;
    expect(whileDraft.id).toBe(before.id);

    const submittedResponse = await request(
      baseUrl,
      `/v1/admin/narrations/${draft.id}/submit`,
      { method: 'POST', token: editor.accessToken },
    );
    expect(submittedResponse.status).toBe(200);

    const editorApproval = await request(
      baseUrl,
      `/v1/admin/narrations/${draft.id}/approve`,
      { method: 'POST', token: editor.accessToken },
    );
    expect(editorApproval.status).toBe(403);

    const approvedResponse = await request(
      baseUrl,
      `/v1/admin/narrations/${draft.id}/approve`,
      { method: 'POST', token: reviewer.accessToken },
    );
    expect(approvedResponse.status).toBe(200);
    expect((await approvedResponse.json()) as AdminNarration).toMatchObject({
      id: draft.id,
      status: 'published',
    });

    const published = (await (
      await request(baseUrl, `/v1/pois/${POI_ID}/narration?locale=en`)
    ).json()) as PoiNarration;
    expect(published.id).toBe(draft.id);

    const revisions = (await (
      await request(baseUrl, `/v1/admin/pois/${POI_ID}/narrations`, {
        token: reviewer.accessToken,
      })
    ).json()) as AdminNarration[];
    expect(revisions.find((item) => item.id === before.id)?.status).toBe(
      'superseded',
    );
  }, 30_000);

  it('rejects an audio object key that does not match POI/locale/hash', async () => {
    const editor = await account('narration-audio-editor@example.com', [
      'EDITOR',
    ]);
    const sha256 = 'a'.repeat(64);
    const response = await request(
      baseUrl,
      `/v1/admin/pois/${POI_ID}/narrations`,
      {
        method: 'POST',
        token: editor.accessToken,
        body: {
          locale: 'vi',
          transcript:
            'Bản thuyết minh âm thanh giả lập dùng để kiểm thử metadata.',
          audio: {
            objectKey: `poi/00000000-0000-4000-8000-000000000999/vi/${sha256}.mp3`,
            mimeType: 'audio/mpeg',
            sizeBytes: 1024,
            sha256,
            durationSeconds: 12.5,
            rightsOwner: 'Dam Sen Smart Guide test fixture',
            rightsSource: 'Synthetic local fixture',
            usageRights: 'Project-owned test use only',
          },
        },
      },
    );
    expect(response.status).toBe(400);
  });

  it('returns MEDIA_STORAGE_UNAVAILABLE when signing is disabled', async () => {
    const editor = await account('media-disabled-editor@example.com', [
      'EDITOR',
    ]);
    const response = await request(baseUrl, '/v1/admin/media/presign', {
      method: 'POST',
      token: editor.accessToken,
      body: {
        poiId: POI_ID,
        locale: 'vi',
        mimeType: 'audio/mpeg',
        sizeBytes: 1024,
        sha256: 'b'.repeat(64),
      },
    });
    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({
      code: 'MEDIA_STORAGE_UNAVAILABLE',
    });
  });
});
