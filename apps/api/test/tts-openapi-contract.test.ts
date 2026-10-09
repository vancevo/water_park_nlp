import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

/**
 * Lightweight contract guard for I02-7: the TTS endpoints must document their
 * error responses and every stable code the API/worker can return. Text-based
 * on purpose (no YAML dependency in the API workspace).
 */
const spec = readFileSync(
  fileURLToPath(new URL('../openapi.yaml', import.meta.url)),
  'utf8',
);

function pathBlock(path: string): string {
  const start = spec.indexOf(`  ${path}:\n`);
  expect(start, `${path} is documented`).toBeGreaterThan(-1);
  const rest = spec.slice(start + path.length + 4);
  const next = rest.search(/\n {2}\/v1\//u);
  return next === -1 ? rest : rest.slice(0, next);
}

describe('OpenAPI TTS contract (v1.1)', () => {
  it('documents error responses on every TTS endpoint', () => {
    const create = pathBlock('/v1/admin/narrations/{narrationId}/tts-jobs');
    for (const status of [
      '202',
      '400',
      '401',
      '403',
      '404',
      '409',
      '429',
      '503',
    ])
      expect(create).toContain(`'${status}':`);
    for (const path of [
      '/v1/admin/tts-jobs/{jobId}',
      '/v1/admin/tts-jobs/{jobId}/cancel',
      '/v1/admin/narrations/{narrationId}/tts-jobs/latest',
    ]) {
      const block = pathBlock(path);
      for (const status of ['200', '401', '403', '404'])
        expect(block, path).toContain(`'${status}':`);
    }
  });

  it('documents every stable request and job error code', () => {
    for (const code of [
      'NARRATION_LOCALE_DISABLED',
      'TTS_JOB_LOCALE_MISMATCH',
      'TTS_JOB_TRANSCRIPT_EMPTY',
      'TTS_VOICE_UNAVAILABLE',
      'NARRATION_NOT_DRAFT',
      'TTS_JOB_IN_PROGRESS',
      'rate_limited',
      'concurrency_limited',
      'AI_FEATURE_DISABLED',
      'NARRATION_AUDIO_NOT_FOUND',
      'TTS_PROVIDER_ERROR',
      'TTS_TIMEOUT',
      'TTS_AUDIO_INVALID',
      'TTS_STORAGE_ERROR',
      'TTS_MODEL_UNAVAILABLE',
      'TTS_NARRATION_NOT_DRAFT',
      'TTS_TRANSCRIPT_STALE',
      'TTS_WORKER_LOST',
    ])
      expect(spec, code).toContain(code);
  });

  it('keeps v1 job fields required and v1.1 additions optional', () => {
    const job = spec.slice(spec.indexOf('    TtsGenerationJob:\n'));
    const required = job.slice(0, job.indexOf('properties:'));
    for (const field of [
      'id',
      'narrationId',
      'status',
      'provider',
      'model',
      'modelVersion',
      'createdAt',
      'updatedAt',
    ])
      expect(required).toContain(field);
    expect(required).not.toContain('artifact');
    expect(required).not.toContain('errorCode');
  });

  it('documents the optional public AI provenance without a job id (v1.2)', () => {
    const audio = spec.slice(spec.indexOf('    PublicNarrationAudio:\n'));
    const block = audio.slice(0, audio.indexOf('\n    PoiNarration:\n'));
    const required = block.slice(0, block.indexOf('properties:'));
    expect(required).not.toContain('generatedBy');
    expect(block).toContain('generatedBy:');
    const provenance = block.slice(
      block.indexOf('    PublicNarrationAudioProvenance:'),
    );
    expect(provenance).toContain('modelVersion');
    expect(provenance).not.toContain('jobId');
  });
});
