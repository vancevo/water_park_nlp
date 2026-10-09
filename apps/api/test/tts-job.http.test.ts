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
import {
  NARRATION_REPOSITORY,
  type NarrationRepository,
} from '../src/narration/narration.models.js';

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

  // --- I02 ---

  async function freshDraft(poiId: string, locale = 'en'): Promise<string> {
    const created = await request(
      baseUrl,
      `/v1/admin/pois/${poiId}/narrations`,
      {
        method: 'POST',
        token: editorToken,
        body: {
          locale,
          transcript: 'An English draft narration used by the I02 HTTP tests.',
        },
      },
    );
    expect(created.status).toBe(201);
    return ((await created.json()) as AdminNarration).id;
  }

  it('locks submit and edit while a job is queued; unlocks after cancel (I02-6)', async () => {
    const id = await freshDraft('00000000-0000-4000-8000-000000000102');
    const created = await request(
      baseUrl,
      `/v1/admin/narrations/${id}/tts-jobs`,
      {
        method: 'POST',
        token: editorToken,
        body: { locale: 'en' },
      },
    );
    const job = (await created.json()) as TtsGenerationJob;

    const submit = await request(baseUrl, `/v1/admin/narrations/${id}/submit`, {
      method: 'POST',
      token: editorToken,
    });
    expect(submit.status).toBe(409);
    expect(await submit.json()).toMatchObject({ code: 'TTS_JOB_IN_PROGRESS' });
    const edit = await request(baseUrl, `/v1/admin/narrations/${id}`, {
      method: 'PATCH',
      token: editorToken,
      body: {
        transcript: 'An edited English draft narration for the I02 test.',
      },
    });
    expect(edit.status).toBe(409);

    await request(baseUrl, `/v1/admin/tts-jobs/${job.id}/cancel`, {
      method: 'POST',
      token: editorToken,
    });
    const submitted = await request(
      baseUrl,
      `/v1/admin/narrations/${id}/submit`,
      {
        method: 'POST',
        token: editorToken,
      },
    );
    expect(submitted.status).toBe(200);

    // I02-5: a pending_review narration cannot get a job.
    const pending = await request(
      baseUrl,
      `/v1/admin/narrations/${id}/tts-jobs`,
      {
        method: 'POST',
        token: editorToken,
        body: { locale: 'en' },
      },
    );
    expect(pending.status).toBe(409);
    expect(await pending.json()).toMatchObject({ code: 'NARRATION_NOT_DRAFT' });
  }, 30_000);

  it('latest job endpoint, RBAC and non-v4 seeded narration ids (I02-9, I02-11)', async () => {
    const id = await freshDraft('00000000-0000-4000-8000-000000000103');
    const none = await request(
      baseUrl,
      `/v1/admin/narrations/${id}/tts-jobs/latest`,
      { token: editorToken },
    );
    expect(none.status).toBe(200);
    expect(await none.json()).toEqual({ job: null });

    const visitor = await request(
      baseUrl,
      `/v1/admin/narrations/${id}/tts-jobs/latest`,
      { token: visitorToken },
    );
    expect(visitor.status).toBe(403);

    // md5-derived (version 3-like) id as created by migration 006 seeds.
    const seededId = '5d41402a-bc4b-3a76-b971-9d911017c592';
    const repo = app.get<NarrationRepository>(NARRATION_REPOSITORY);
    const at = new Date();
    await repo.save({
      id: seededId,
      poiId: '00000000-0000-4000-8000-000000000104',
      locale: 'vi',
      revision: 9,
      transcript: 'Bản nháp seed có id không phải UUID v4 để kiểm thử I02.',
      status: 'draft',
      audio: null,
      createdAt: at,
      updatedAt: at,
    });
    const seeded = await request(
      baseUrl,
      `/v1/admin/narrations/${seededId}/tts-jobs`,
      { method: 'POST', token: editorToken, body: { locale: 'vi' } },
    );
    expect(seeded.status).toBe(202);
    const latest = await request(
      baseUrl,
      `/v1/admin/narrations/${seededId}/tts-jobs/latest`,
      { token: editorToken },
    );
    expect(
      ((await latest.json()) as { job: TtsGenerationJob }).job.narrationId,
    ).toBe(seededId);
  }, 30_000);

  it('admin audio playback: 404 without audio, 503 when storage is off (I02-11)', async () => {
    const id = await freshDraft('00000000-0000-4000-8000-000000000105');
    const missing = await request(
      baseUrl,
      `/v1/admin/narrations/${id}/audio/playback`,
      { token: editorToken },
    );
    expect(missing.status).toBe(404);
    expect(await missing.json()).toMatchObject({
      code: 'NARRATION_AUDIO_NOT_FOUND',
    });
  }, 30_000);

  it('kill switch: create answers 503 AI_FEATURE_DISABLED (I02-4)', async () => {
    const id = await freshDraft('00000000-0000-4000-8000-000000000101', 'en');
    process.env.TTS_GENERATION_ENABLED = 'false';
    try {
      const blocked = await request(
        baseUrl,
        `/v1/admin/narrations/${id}/tts-jobs`,
        { method: 'POST', token: editorToken, body: { locale: 'en' } },
      );
      expect(blocked.status).toBe(503);
      expect(await blocked.json()).toMatchObject({
        code: 'AI_FEATURE_DISABLED',
      });
    } finally {
      delete process.env.TTS_GENERATION_ENABLED;
    }
  }, 30_000);
});
