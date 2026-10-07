import { ApiClientError } from '@damsen/api-client';
import { describe, expect, it, vi } from 'vitest';
import { createDemoToneWav } from './demo-wav';
import {
  createFixtureTtsGenerationPort,
  createHttpTtsGenerationPort,
  isTerminalTtsStatus,
  ttsGenerationMode,
  ttsRequestErrorMessage,
} from './tts-generation';

function clock(start = Date.parse('2026-10-07T00:00:00.000Z')) {
  let value = start;
  return { now: () => value, advance: (ms: number) => (value += ms) };
}

describe('fixture TTS generation port', () => {
  it('simulates queued → running → succeeded with contract-v1 fields', async () => {
    const time = clock();
    const port = createFixtureTtsGenerationPort({
      now: time.now,
      queuedMs: 100,
      runningMs: 200,
    });
    const job = await port.create('n1', { locale: 'vi' });
    expect(job).toMatchObject({
      narrationId: 'n1',
      status: 'queued',
      provider: 'piper',
      model: 'demo-voice-vi',
      modelVersion: 'demo-fixture-2026.10.0',
    });
    expect(job.errorCode).toBeUndefined();
    time.advance(150);
    expect((await port.get(job.id)).status).toBe('running');
    time.advance(200);
    const done = await port.get(job.id);
    expect(done.status).toBe('succeeded');
    expect(done.updatedAt > done.createdAt).toBe(true);
    expect(await port.previewAudio?.(done)).toBeInstanceOf(Blob);
  });

  it('fails the first French attempt with a stable code, then succeeds on retry', async () => {
    const time = clock();
    const port = createFixtureTtsGenerationPort({
      now: time.now,
      queuedMs: 10,
      runningMs: 10,
    });
    const first = await port.create('n1', { locale: 'fr' });
    time.advance(50);
    const failed = await port.get(first.id);
    expect(failed).toMatchObject({
      status: 'failed',
      errorCode: 'TTS_TIMEOUT',
    });
    expect(await port.previewAudio?.(failed)).toBeNull();
    const retry = await port.create('n1', { locale: 'fr' });
    expect(retry.id).not.toBe(first.id);
    time.advance(50);
    expect((await port.get(retry.id)).status).toBe('succeeded');
  });

  it('returns the in-flight job for a duplicate create (idempotent)', async () => {
    const time = clock();
    const port = createFixtureTtsGenerationPort({ now: time.now });
    const first = await port.create('n1', { locale: 'en' });
    const duplicate = await port.create('n1', { locale: 'en' });
    expect(duplicate.id).toBe(first.id);
    const otherLocale = await port.create('n1', { locale: 'vi' });
    expect(otherLocale.id).not.toBe(first.id);
  });

  it('cancels queued/running jobs and leaves terminal jobs unchanged', async () => {
    const time = clock();
    const port = createFixtureTtsGenerationPort({
      now: time.now,
      queuedMs: 10,
      runningMs: 10,
      outcome: () => ({ status: 'failed', errorCode: 'TTS_PROVIDER_ERROR' }),
    });
    const running = await port.create('n1', { locale: 'vi' });
    time.advance(15);
    expect((await port.cancel(running.id)).status).toBe('cancelled');
    time.advance(100);
    expect((await port.get(running.id)).status).toBe('cancelled');

    const failing = await port.create('n2', { locale: 'vi' });
    time.advance(100);
    const cancelled = await port.cancel(failing.id);
    expect(cancelled).toMatchObject({
      status: 'failed',
      errorCode: 'TTS_PROVIDER_ERROR',
    });
    await expect(port.get('missing')).rejects.toThrow('Không tìm thấy');
  });
});

describe('HTTP TTS generation port', () => {
  it('maps create/get/cancel to the typed client with the session token', async () => {
    const job = {
      id: 'j1',
      narrationId: 'n1',
      status: 'queued' as const,
      provider: 'piper',
      model: 'm',
      modelVersion: 'v1',
      createdAt: '2026-10-07T00:00:00.000Z',
      updatedAt: '2026-10-07T00:00:00.000Z',
    };
    const api = {
      createTtsJob: vi.fn(async () => job),
      getTtsJob: vi.fn(async () => job),
      cancelTtsJob: vi.fn(async () => ({
        ...job,
        status: 'cancelled' as const,
      })),
    };
    const port = createHttpTtsGenerationPort(api, () => 'token');
    await port.create('n1', { locale: 'fr' });
    await port.get('j1');
    await port.cancel('j1');
    expect(api.createTtsJob).toHaveBeenCalledWith(
      'n1',
      { locale: 'fr' },
      'token',
    );
    expect(api.getTtsJob).toHaveBeenCalledWith('j1', 'token');
    expect(api.cancelTtsJob).toHaveBeenCalledWith('j1', 'token');
    expect(port.previewAudio).toBeUndefined();
    expect(port.mode).toBe('api');
  });

  it('maps HTTP failures to safe Vietnamese messages', () => {
    const error = (status: number) =>
      new ApiClientError(status, {
        code: 'X',
        message: 'internal detail',
        details: null,
        requestId: 'r',
      });
    expect(ttsRequestErrorMessage(error(403))).toContain('không có quyền');
    expect(ttsRequestErrorMessage(error(409))).toContain('không cho phép');
    expect(ttsRequestErrorMessage(error(500))).toBe(
      'Máy chủ không xử lý được yêu cầu (HTTP 500).',
    );
    expect(ttsRequestErrorMessage('boom')).toBe(
      'Không thể kết nối dịch vụ tạo audio.',
    );
  });
});

describe('TTS generation flags and helpers', () => {
  it('keeps generation off unless explicitly enabled', () => {
    expect(ttsGenerationMode(undefined)).toBe('off');
    expect(ttsGenerationMode('demo')).toBe('demo');
    expect(ttsGenerationMode('api')).toBe('api');
    expect(ttsGenerationMode('yes')).toBe('off');
  });

  it('knows terminal statuses', () => {
    expect(
      ['queued', 'running'].map((s) => isTerminalTtsStatus(s as never)),
    ).toEqual([false, false]);
    expect(
      ['succeeded', 'failed', 'cancelled'].every((s) =>
        isTerminalTtsStatus(s as never),
      ),
    ).toBe(true);
  });

  it('builds a valid PCM WAV header for demo previews', () => {
    const wav = createDemoToneWav(0.1, 440, 8_000);
    const text = (from: number, to: number) =>
      String.fromCharCode(...wav.slice(from, to));
    expect(text(0, 4)).toBe('RIFF');
    expect(text(8, 12)).toBe('WAVE');
    expect(wav.length).toBe(44 + 800 * 2);
  });
});
