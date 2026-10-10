import { spawnSync } from 'node:child_process';

import { describe, expect, it } from 'vitest';

import {
  AudioEncoderConfigError,
  FfmpegAudioEncoder,
  TtsEncodeError,
  createAudioEncoder,
  loadAudioEncoderConfig,
  verifyEncodedAudio,
} from '../src/tts/audio-encoder.js';
import { TtsAudioInvalidError } from '../src/tts/tts-audio-validation.js';
import { errorCodeOf } from '../src/tts/tts-generation-service.js';

const hasFfmpeg =
  spawnSync('ffmpeg', ['-version'], { stdio: 'ignore' }).status === 0;

/** 1 s, 22.05 kHz, mono 16-bit PCM sine — what Piper produces. */
function sineWav(seconds = 1, rate = 22_050): Uint8Array {
  const samples = Math.round(seconds * rate);
  const data = Buffer.alloc(samples * 2);
  for (let i = 0; i < samples; i += 1) {
    data.writeInt16LE(
      Math.round(Math.sin((2 * Math.PI * 440 * i) / rate) * 8000),
      i * 2,
    );
  }
  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // mono
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(data.length, 40);
  return new Uint8Array(Buffer.concat([header, data]));
}

describe('C04: release encoder config', () => {
  it('defaults to WAV (no encoder) with 64k speech bitrate', () => {
    const config = loadAudioEncoderConfig({});
    expect(config).toEqual({
      format: 'wav',
      ffmpegPath: 'ffmpeg',
      bitrate: '64k',
    });
    expect(createAudioEncoder(config)).toBeNull();
  });

  it('builds an ffmpeg encoder for mp3/m4a', () => {
    const encoder = createAudioEncoder(
      loadAudioEncoderConfig({
        TTS_AUDIO_RELEASE_FORMAT: 'MP3',
        TTS_AUDIO_BITRATE: '96k',
        TTS_FFMPEG_PATH: '/opt/ffmpeg',
      }),
    );
    expect(encoder).toBeInstanceOf(FfmpegAudioEncoder);
    expect(encoder?.format).toBe('mp3');
  });

  it('fails fast on an unknown format or malformed bitrate', () => {
    expect(() =>
      loadAudioEncoderConfig({ TTS_AUDIO_RELEASE_FORMAT: 'flac' }),
    ).toThrow(AudioEncoderConfigError);
    expect(() =>
      loadAudioEncoderConfig({ TTS_AUDIO_BITRATE: '64 kbps' }),
    ).toThrow(AudioEncoderConfigError);
  });
});

describe('C04: verifyEncodedAudio', () => {
  const padded = (head: number[], at = 0) => {
    const bytes = new Uint8Array(256);
    bytes.set(head, at);
    return bytes;
  };

  it('accepts ID3-tagged or frame-synced mp3 and ftyp m4a', () => {
    expect(() =>
      verifyEncodedAudio(padded([0x49, 0x44, 0x33]), 'mp3'),
    ).not.toThrow();
    expect(() => verifyEncodedAudio(padded([0xff, 0xfb]), 'mp3')).not.toThrow();
    expect(() =>
      verifyEncodedAudio(padded([0x66, 0x74, 0x79, 0x70], 4), 'm4a'),
    ).not.toThrow();
  });

  it('rejects empty, tiny or wrongly-typed output as TTS_AUDIO_INVALID', () => {
    for (const [bytes, format] of [
      [new Uint8Array(0), 'mp3'],
      [padded([0x52, 0x49, 0x46, 0x46]), 'mp3'], // a WAV, not mp3
      [padded([0x49, 0x44, 0x33]), 'm4a'],
    ] as const) {
      let caught: unknown;
      try {
        verifyEncodedAudio(bytes, format);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(TtsAudioInvalidError);
      expect(errorCodeOf(caught)).toBe('TTS_AUDIO_INVALID');
    }
  });
});

describe('C04: FfmpegAudioEncoder', () => {
  it('reports a missing ffmpeg binary with a stable code', async () => {
    const encoder = new FfmpegAudioEncoder({
      format: 'mp3',
      ffmpegPath: '/nonexistent/ffmpeg',
      bitrate: '64k',
    });
    const error = await encoder.encode(sineWav(0.2)).catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TtsEncodeError);
    expect(errorCodeOf(error)).toBe('TTS_AUDIO_INVALID');
  });

  it.skipIf(!hasFfmpeg)('encodes a WAV to a smaller, valid mp3', async () => {
    const wav = sineWav(1);
    const encoder = new FfmpegAudioEncoder({
      format: 'mp3',
      ffmpegPath: 'ffmpeg',
      bitrate: '64k',
    });
    const encoded = await encoder.encode(wav);
    expect(encoded.mimeType).toBe('audio/mpeg');
    expect(encoded.extension).toBe('mp3');
    expect(encoded.audio.length).toBeLessThan(wav.length / 3);
    expect(() => verifyEncodedAudio(encoded.audio, 'mp3')).not.toThrow();
  });

  it.skipIf(!hasFfmpeg)('encodes a WAV to a faststart m4a', async () => {
    const encoder = new FfmpegAudioEncoder({
      format: 'm4a',
      ffmpegPath: 'ffmpeg',
      bitrate: '64k',
    });
    const encoded = await encoder.encode(sineWav(1));
    expect(encoded.mimeType).toBe('audio/mp4');
    expect(encoded.extension).toBe('m4a');
    expect(() => verifyEncodedAudio(encoded.audio, 'm4a')).not.toThrow();
    // faststart: the moov index precedes the media data.
    const text = Buffer.from(encoded.audio).toString('latin1');
    expect(text.indexOf('moov')).toBeLessThan(text.indexOf('mdat'));
  });

  it.skipIf(!hasFfmpeg)('fails closed on input that is not WAV', async () => {
    const encoder = new FfmpegAudioEncoder({
      format: 'mp3',
      ffmpegPath: 'ffmpeg',
      bitrate: '64k',
    });
    const error = await encoder
      .encode(new Uint8Array(512).fill(1))
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(TtsEncodeError);
  });

  it.skipIf(!hasFfmpeg)('stops on abort', async () => {
    const encoder = new FfmpegAudioEncoder({
      format: 'mp3',
      ffmpegPath: 'ffmpeg',
      bitrate: '64k',
    });
    const controller = new AbortController();
    controller.abort();
    await expect(
      encoder.encode(sineWav(0.2), controller.signal),
    ).rejects.toBeInstanceOf(TtsEncodeError);
  });
});
