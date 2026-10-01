import { describe, expect, it } from 'vitest';

import {
  isWavContainer,
  validateSynthesizedAudio,
} from '../src/tts/tts-audio-validation.js';
import type { TtsSynthesisResult } from '../src/tts/types.js';

function wav(size = 64): Uint8Array {
  const buffer = new Uint8Array(Math.max(12, size));
  buffer.set([0x52, 0x49, 0x46, 0x46], 0);
  buffer.set([0x57, 0x41, 0x56, 0x45], 8);
  return buffer;
}

function result(
  overrides: Partial<TtsSynthesisResult> = {},
): TtsSynthesisResult {
  return {
    audio: wav(),
    mimeType: 'audio/wav',
    durationSeconds: 3.2,
    sampleRateHz: 22_050,
    ...overrides,
  };
}

describe('validateSynthesizedAudio', () => {
  it('accepts a valid WAV result', () => {
    expect(() => validateSynthesizedAudio(result())).not.toThrow();
    expect(isWavContainer(wav())).toBe(true);
  });

  it('rejects a non-WAV mime type', () => {
    expect(() =>
      validateSynthesizedAudio(
        result({ mimeType: 'audio/mpeg' as TtsSynthesisResult['mimeType'] }),
      ),
    ).toThrow('audio/wav');
  });

  it('rejects empty and non-container audio', () => {
    expect(() =>
      validateSynthesizedAudio(result({ audio: new Uint8Array() })),
    ).toThrow('empty');
    expect(() =>
      validateSynthesizedAudio(result({ audio: new Uint8Array(64) })),
    ).toThrow('RIFF/WAVE');
  });

  it('rejects out-of-range duration and bad sample rate', () => {
    expect(() =>
      validateSynthesizedAudio(result({ durationSeconds: 0 })),
    ).toThrow('duration');
    expect(() => validateSynthesizedAudio(result({ sampleRateHz: 0 }))).toThrow(
      'sample rate',
    );
  });

  it('rejects audio over the size limit', () => {
    expect(() =>
      validateSynthesizedAudio(result(), {
        minDurationSeconds: 0.1,
        maxDurationSeconds: 100,
        maxSizeBytes: 10,
      }),
    ).toThrow('size limit');
  });
});
