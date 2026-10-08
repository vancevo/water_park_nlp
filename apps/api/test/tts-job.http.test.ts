import 'reflect-metadata';

import type { NestExpressApplication } from '@nestjs/platform-express';
import type {
  AdminNarration,
  AuthResponse,
  TtsGenerationJob,
  UserRole,
} from '@damsen/shared-types';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createApp } from '../src/bootstrap.js';
import {
  AUTH_REPOSITORY,
  type AuthRepository,
} from '../src/auth/auth.models.js';

const POI_ID = '00000000-0000-4000-8000-000000000101';
const UNKNOWN_ID = '00000000-0000-4000-8000-0000000009ff';

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

describe('admin TTS job HTTP API', () => {
  let app: NestExpressApplication;
  let baseUrl: string;
  let authRepository: AuthRepository;
  let editorToken: string;
  let visitorToken: string;
  let narrationId: string;

  async function account(email: string, roles: UserRole[]): Promise<string> {
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
    return ((await login.json()) as AuthResponse).accessToken;
  }

  beforeAll(async () => {
    delete process.env.DATABASE_URL;
    process.env.S3_ENABLED = 'false';
    app = await createApp();
    await app.listen(0, '127.0.0.1');
    baseUrl = await app.getUrl();
    authRepository = app.get<AuthRepository>(AUTH_REPOSITORY);

    editorToken = await account('tts-editor@example.com', ['EDITOR']);
    visitorToken = await account('tts-visitor@example.com', ['VISITOR']);

    // One shared vi draft narration to attach TTS jobs to.
    const created = await request(
      baseUrl,
      `/v1/admin/pois/${POI_ID}/narrations`,
      {
        method: 'POST',
        token: editorToken,
        body: {
          locale: 'vi',
          transcript:
            'Bản thuyết minh tiếng Việt dùng để kiểm thử hàng đợi TTS backend.',
        },
      },
    );
    narrationId = ((await created.json()) as AdminNarration).id;
  }, 30_000);

  afterAll(async () => {
    delete process.env.S3_ENABLED;
    await app.close();
  });

  it('rejects visitors and unauthenticated callers', async () => {
    const visitorAttempt = await request(
      baseUrl,
      `/v1/admin/narrations/${narrationId}/tts-jobs`,
      { method: 'POST', token: visitorToken, body: { locale: 'vi' } },
    );
    expect(visitorAttempt.status).toBe(403);

    const anon = await request(
      baseUrl,
      `/v1/admin/narrations/${narrationId}/tts-jobs`,
      { method: 'POST', body: { locale: 'vi' } },
    );
    expect(anon.status).toBe(401);
  });

  it('enqueues a draft job, is idempotent, polls and cancels', async () => {
    const created = await request(
      baseUrl,
      `/v1/admin/narrations/${narrationId}/tts-jobs`,
      { method: 'POST', token: editorToken, body: { locale: 'vi' } },
    );
    expect(created.status).toBe(202);
    const job = (await created.json()) as TtsGenerationJob;
    expect(job).toMatchObject({ narrationId, status: 'queued' });

    const again = await request(
      baseUrl,
      `/v1/admin/narrations/${narrationId}/tts-jobs`,
      { method: 'POST', token: editorToken, body: { locale: 'vi' } },
    );
    expect(again.status).toBe(202);
    expect(((await again.json()) as TtsGenerationJob).id).toBe(job.id);

    const polled = await request(baseUrl, `/v1/admin/tts-jobs/${job.id}`, {
      token: editorToken,
    });
    expect(polled.status).toBe(200);
    expect(((await polled.json()) as TtsGenerationJob).id).toBe(job.id);

    const cancelled = await request(
      baseUrl,
      `/v1/admin/tts-jobs/${job.id}/cancel`,
      { method: 'POST', token: editorToken },
    );
    expect(cancelled.status).toBe(200);
    expect(((await cancelled.json()) as TtsGenerationJob).status).toBe(
      'cancelled',
    );
  }, 30_000);

  it('validates locale and narration existence', async () => {
    const disabled = await request(
      baseUrl,
      `/v1/admin/narrations/${narrationId}/tts-jobs`,
      { method: 'POST', token: editorToken, body: { locale: 'de' } },
    );
    expect(disabled.status).toBe(400);

    const mismatch = await request(
      baseUrl,
      `/v1/admin/narrations/${narrationId}/tts-jobs`,
      { method: 'POST', token: editorToken, body: { locale: 'en' } },
    );
    expect(mismatch.status).toBe(400);
    expect(await mismatch.json()).toMatchObject({
      code: 'TTS_JOB_LOCALE_MISMATCH',
    });

    const unknownNarration = await request(
      baseUrl,
      `/v1/admin/narrations/${UNKNOWN_ID}/tts-jobs`,
      { method: 'POST', token: editorToken, body: { locale: 'vi' } },
    );
    expect(unknownNarration.status).toBe(404);

    const unknownJob = await request(
      baseUrl,
      `/v1/admin/tts-jobs/${UNKNOWN_ID}`,
      { token: editorToken },
    );
    expect(unknownJob.status).toBe(404);
  }, 30_000);
});
