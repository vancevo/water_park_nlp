import { describe, expect, it } from 'vitest';

import {
  PiperSynthesisError,
  PiperTtsProvider,
  type PiperRunInput,
} from '../src/tts/piper/piper-tts-provider.js';

function ascii(buf: Uint8Array, offset: number, text: string): void {
  for (let i = 0; i < text.length; i += 1) buf[offset + i] = text.charCodeAt(i);
}

function buildWav(sampleRate = 22_050, samples = 22_050): Uint8Array {
  const dataBytes = samples * 2;
  const buf = new Uint8Array(44 + dataBytes);
  const dv = new DataView(buf.buffer);
  ascii(buf, 0, 'RIFF');
  dv.setUint32(4, 36 + dataBytes, true);
  ascii(buf, 8, 'WAVE');
  ascii(buf, 12, 'fmt ');
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);
  dv.setUint16(22, 1, true);
  dv.setUint32(24, sampleRate, true);
  dv.setUint32(28, sampleRate * 2, true);
  dv.setUint16(32, 2, true);
  dv.setUint16(34, 16, true);
  ascii(buf, 36, 'data');
  dv.setUint32(40, dataBytes, true);
  return buf;
}

function provider(runner: (input: PiperRunInput) => Promise<Uint8Array>) {
  return new PiperTtsProvider(
    {
      model: 'vi_VN-vais1000-medium',
      modelVersion: 'piper-voices-v1.0.0',
      voiceId: 'vi_VN-vais1000-medium',
      locale: 'vi',
      binaryPath: '/usr/bin/piper',
      modelPath: '/voices/vi.onnx',
      speaker: 0,
      lengthScale: 1.1,
    },
    runner,
  );
}

describe('PiperTtsProvider', () => {
  it('runs the binary and parses the resulting WAV', async () => {
    let captured: PiperRunInput | null = null;
    const result = await provider(async (input) => {
      captured = input;
      return buildWav(22_050, 11_025); // 0.5s
    }).synthesize({
      transcript: 'Xin chào Đầm Sen.',
      locale: 'vi',
      voiceId: 'vi_VN-vais1000-medium',
      config: {},
      seed: null,
    });

    expect(result.mimeType).toBe('audio/wav');
    expect(result.sampleRateHz).toBe(22_050);
    expect(result.durationSeconds).toBeCloseTo(0.5, 3);
    expect(captured!.binaryPath).toBe('/usr/bin/piper');
    expect(captured!.modelPath).toBe('/voices/vi.onnx');
    expect(captured!.text).toBe('Xin chào Đầm Sen.');
    expect(captured!.extraArgs).toEqual([
      '--speaker',
      '0',
      '--length_scale',
      '1.1',
    ]);
  });

  it('reports the locale it serves', () => {
    const p = provider(async () => buildWav());
    expect(p.supportsLocale('vi')).toBe(true);
    expect(p.supportsLocale('en')).toBe(false);
    expect(p.provider).toBe('piper');
  });

  it('propagates a provider failure', async () => {
    await expect(
      provider(async () => {
        throw new PiperSynthesisError('exited with code 1');
      }).synthesize({
        transcript: 'x',
        locale: 'vi',
        voiceId: 'v',
        config: {},
        seed: null,
      }),
    ).rejects.toBeInstanceOf(PiperSynthesisError);
  });
});
