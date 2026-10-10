import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { killProcessTree } from './process-kill.js';
import { TtsAudioInvalidError } from './tts-audio-validation.js';

/**
 * Release encoding (C04 / ADR 0009 §4 follow-up). Providers return a lossless
 * WAV intermediate, which is validated (duration/silence/clipping) BEFORE this
 * step; the encoder then turns it into a smaller, browser-playable release
 * file for the draft narration. WAV stays the default, so nothing changes
 * unless `TTS_AUDIO_RELEASE_FORMAT` is set.
 *
 * Runs ffmpeg as a separate process (no native codec in the worker), with the
 * same abort/kill-tree handling as CLI providers. Logs nothing but codes.
 */

export type TtsReleaseFormat = 'wav' | 'mp3' | 'm4a';
export type TtsReleaseMimeType = 'audio/wav' | 'audio/mpeg' | 'audio/mp4';

export const RELEASE_MIME: Readonly<
  Record<TtsReleaseFormat, TtsReleaseMimeType>
> = {
  wav: 'audio/wav',
  mp3: 'audio/mpeg',
  m4a: 'audio/mp4',
};

export interface EncodedAudio {
  audio: Uint8Array;
  mimeType: TtsReleaseMimeType;
  /** Object-key extension, matching the API's EXTENSION_BY_MIME. */
  extension: TtsReleaseFormat;
}

export interface AudioEncoder {
  readonly format: Exclude<TtsReleaseFormat, 'wav'>;
  encode(wav: Uint8Array, signal?: AbortSignal): Promise<EncodedAudio>;
}

export interface AudioEncoderConfig {
  format: TtsReleaseFormat;
  ffmpegPath: string;
  /** Target bitrate, e.g. `64k` (speech; mono). */
  bitrate: string;
}

export class AudioEncoderConfigError extends Error {
  constructor(message: string) {
    super(`tts audio encoder config: ${message}`);
    this.name = 'AudioEncoderConfigError';
  }
}

/**
 * Stable, non-sensitive error: the encoder failed. Reported as the existing
 * `TTS_AUDIO_INVALID` code (no release-playable audio was produced) so the
 * public error-code contract does not change.
 */
export class TtsEncodeError extends Error {
  readonly code = 'TTS_AUDIO_INVALID';
  constructor(detail: string) {
    super(`audio encode failed: ${detail}`);
    this.name = 'TtsEncodeError';
  }
}

export function loadAudioEncoderConfig(
  env: NodeJS.ProcessEnv = process.env,
): AudioEncoderConfig {
  const format = (env.TTS_AUDIO_RELEASE_FORMAT?.trim().toLowerCase() ||
    'wav') as TtsReleaseFormat;
  if (!(format in RELEASE_MIME))
    throw new AudioEncoderConfigError(
      'TTS_AUDIO_RELEASE_FORMAT must be "wav", "mp3" or "m4a"',
    );
  const bitrate = env.TTS_AUDIO_BITRATE?.trim() || '64k';
  if (!/^\d{2,3}k$/u.test(bitrate))
    throw new AudioEncoderConfigError(
      'TTS_AUDIO_BITRATE must look like "64k" (32k–320k)',
    );
  return {
    format,
    ffmpegPath: env.TTS_FFMPEG_PATH?.trim() || 'ffmpeg',
    bitrate,
  };
}

/** null when the release format is the WAV intermediate itself. */
export function createAudioEncoder(
  config: AudioEncoderConfig,
): AudioEncoder | null {
  return config.format === 'wav'
    ? null
    : new FfmpegAudioEncoder({ ...config, format: config.format });
}

function codecArgs(
  format: Exclude<TtsReleaseFormat, 'wav'>,
  bitrate: string,
): string[] {
  return format === 'mp3'
    ? ['-c:a', 'libmp3lame', '-b:a', bitrate, '-f', 'mp3']
    : // faststart puts the index first so browsers can start playback early.
      ['-c:a', 'aac', '-b:a', bitrate, '-movflags', '+faststart', '-f', 'mp4'];
}

/**
 * Checks the container signature, so a misconfigured ffmpeg (wrong codec,
 * empty output) fails the attempt instead of attaching unplayable audio.
 */
export function verifyEncodedAudio(
  audio: Uint8Array,
  format: Exclude<TtsReleaseFormat, 'wav'>,
): void {
  if (audio.length < 128)
    throw new TtsAudioInvalidError(`encoded ${format} is too small`);
  if (format === 'mp3') {
    const id3 = audio[0] === 0x49 && audio[1] === 0x44 && audio[2] === 0x33;
    const frameSync = audio[0] === 0xff && (audio[1]! & 0xe0) === 0xe0;
    if (!id3 && !frameSync)
      throw new TtsAudioInvalidError('encoded mp3 has no ID3/frame header');
    return;
  }
  const ftyp = String.fromCharCode(...audio.subarray(4, 8));
  if (ftyp !== 'ftyp')
    throw new TtsAudioInvalidError('encoded m4a has no ftyp box');
}

export class FfmpegAudioEncoder implements AudioEncoder {
  readonly format: Exclude<TtsReleaseFormat, 'wav'>;

  constructor(
    private readonly config: AudioEncoderConfig & {
      format: Exclude<TtsReleaseFormat, 'wav'>;
    },
  ) {
    this.format = config.format;
  }

  async encode(wav: Uint8Array, signal?: AbortSignal): Promise<EncodedAudio> {
    if (signal?.aborted) throw new TtsEncodeError('aborted');
    const dir = await mkdtemp(join(tmpdir(), 'tts-encode-'));
    const outPath = join(dir, `${randomUUID()}.${this.format}`);
    try {
      await this.run(
        [
          '-hide_banner',
          '-loglevel',
          'error',
          '-f',
          'wav',
          '-i',
          'pipe:0',
          '-vn',
          '-ac',
          '1',
          ...codecArgs(this.format, this.config.bitrate),
          '-y',
          outPath,
        ],
        wav,
        signal,
      );
      const audio = new Uint8Array(await readFile(outPath));
      verifyEncodedAudio(audio, this.format);
      return {
        audio,
        mimeType: RELEASE_MIME[this.format],
        extension: this.format,
      };
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  }

  private run(
    args: string[],
    stdin: Uint8Array,
    signal?: AbortSignal,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.config.ffmpegPath, args, {
        stdio: ['pipe', 'ignore', 'pipe'],
        detached: process.platform !== 'win32',
        windowsHide: true,
      });
      const stop = () => killProcessTree(child);
      signal?.addEventListener('abort', stop, { once: true });
      // stderr is drained (never logged: it can echo metadata) to avoid a
      // full pipe blocking ffmpeg.
      child.stderr?.resume();
      child.stdin?.on('error', () => undefined); // EPIPE if ffmpeg exits early
      child.on('error', (error: Error & { code?: string }) => {
        signal?.removeEventListener('abort', stop);
        reject(new TtsEncodeError(error.code ?? error.name));
      });
      child.on('close', (code) => {
        signal?.removeEventListener('abort', stop);
        if (signal?.aborted) reject(new TtsEncodeError('aborted'));
        else if (code === 0) resolve();
        else reject(new TtsEncodeError(`ffmpeg exited with ${code ?? 'null'}`));
      });
      child.stdin?.end(stdin);
    });
  }
}
