import type { TtsSynthesisResult } from './types.js';

export class TtsAudioInvalidError extends Error {
  /** Stable code carried into the job record; never includes audio or transcript. */
  readonly code = 'TTS_AUDIO_INVALID';
  constructor(reason: string) {
    super(`tts audio invalid: ${reason}`);
    this.name = 'TtsAudioInvalidError';
  }
}

export interface TtsAudioLimits {
  minDurationSeconds: number;
  maxDurationSeconds: number;
  maxSizeBytes: number;
}

export const DEFAULT_TTS_AUDIO_LIMITS: TtsAudioLimits = {
  minDurationSeconds: 0.2,
  maxDurationSeconds: 1800,
  maxSizeBytes: 52_428_800,
};

/** True when the bytes start with a RIFF/WAVE container header. */
export function isWavContainer(audio: Uint8Array): boolean {
  if (audio.length < 12) return false;
  const ascii = (offset: number, text: string): boolean =>
    [...text].every(
      (char, index) => audio[offset + index] === char.charCodeAt(0),
    );
  return ascii(0, 'RIFF') && ascii(8, 'WAVE');
}

/**
 * Validate a synthesized result before it can become a draft artifact. Foundation
 * checks only: container, non-empty bytes, duration range, size and sample rate.
 * Perceptual checks (clipping/silence) belong to AI03.
 */
export function validateSynthesizedAudio(
  result: TtsSynthesisResult,
  limits: TtsAudioLimits = DEFAULT_TTS_AUDIO_LIMITS,
): void {
  if (result.mimeType !== 'audio/wav') {
    throw new TtsAudioInvalidError('intermediate audio must be audio/wav');
  }
  if (!(result.audio instanceof Uint8Array) || result.audio.length === 0) {
    throw new TtsAudioInvalidError('audio bytes are empty');
  }
  if (result.audio.length > limits.maxSizeBytes) {
    throw new TtsAudioInvalidError('audio exceeds the size limit');
  }
  if (!isWavContainer(result.audio)) {
    throw new TtsAudioInvalidError('audio is not a RIFF/WAVE container');
  }
  if (
    !Number.isFinite(result.durationSeconds) ||
    result.durationSeconds < limits.minDurationSeconds ||
    result.durationSeconds > limits.maxDurationSeconds
  ) {
    throw new TtsAudioInvalidError('audio duration is out of range');
  }
  if (!Number.isInteger(result.sampleRateHz) || result.sampleRateHz <= 0) {
    throw new TtsAudioInvalidError('audio sample rate is invalid');
  }
}
