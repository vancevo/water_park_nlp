import { describe, expect, it } from 'vitest';

import {
  FALLBACK_TTS_JOB_DEFAULTS,
  loadTtsJobDefaults,
  parseTtsVoicesManifest,
  TtsVoicesManifestError,
  usesFallbackTtsDefaults,
} from '../src/narration/tts-job.models.js';

describe('TTS job defaults (I02-8)', () => {
  it('reads per-locale voices from a Piper or CLI worker manifest', () => {
    expect(
      parseTtsVoicesManifest({
        voices: [
          { provider: 'piper', model: 'vi-a', modelVersion: '1', locale: 'vi' },
          { provider: 'piper', model: 'vi-b', modelVersion: '2', locale: 'vi' },
          {
            provider: 'piper',
            model: 'en-a',
            modelVersion: '1',
            locale: 'en',
            enabled: false,
          },
        ],
      }),
    ).toEqual({ vi: { provider: 'piper', model: 'vi-a', modelVersion: '1' } });
    expect(
      parseTtsVoicesManifest({
        entries: [
          { provider: 'cli', model: 'm', modelVersion: 'v', locale: 'en' },
        ],
      }),
    ).toEqual({ en: { provider: 'cli', model: 'm', modelVersion: 'v' } });
    expect(() => parseTtsVoicesManifest({ voices: [] })).toThrow(
      TtsVoicesManifestError,
    );
  });

  it('loads the manifest named by TTS_VOICES_MANIFEST_PATH', () => {
    const defaults = loadTtsJobDefaults(
      { TTS_VOICES_MANIFEST_PATH: 'voices.json' },
      () =>
        JSON.stringify({
          voices: [
            { provider: 'p', model: 'm', modelVersion: 'v', locale: 'vi' },
          ],
        }),
    );
    expect(defaults.voices).toEqual({
      vi: { provider: 'p', model: 'm', modelVersion: 'v' },
    });
    expect(() =>
      loadTtsJobDefaults({ TTS_VOICES_MANIFEST_PATH: 'x.json' }, () => {
        throw new Error('ENOENT');
      }),
    ).toThrow(TtsVoicesManifestError);
  });

  it('uses TTS_DEFAULT_* and flags the fallback when nothing is configured', () => {
    expect(
      loadTtsJobDefaults({
        TTS_DEFAULT_PROVIDER: 'cli',
        TTS_DEFAULT_MODEL: 'tone',
        TTS_DEFAULT_MODEL_VERSION: 'v1',
      }),
    ).toMatchObject({ provider: 'cli', model: 'tone', modelVersion: 'v1' });
    expect(loadTtsJobDefaults({})).toMatchObject(FALLBACK_TTS_JOB_DEFAULTS);
    expect(usesFallbackTtsDefaults({})).toBe(true);
    expect(usesFallbackTtsDefaults({ TTS_DEFAULT_MODEL_VERSION: 'v1' })).toBe(
      false,
    );
  });
});
