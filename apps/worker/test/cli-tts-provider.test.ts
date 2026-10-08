import { describe, expect, it } from 'vitest';

import {
  CliTtsProvider,
  CliTtsTimeoutError,
  type CliRunInput,
  type CliRunner,
} from '../src/tts/providers/cli-tts-provider.js';

/** Minimal valid 16-bit mono PCM WAV with `samples` frames at 22.05 kHz. */
function makeWav(samples: number): Uint8Array {
  const sampleRate = 22_050;
  const dataBytes = samples * 2;
  const buffer = new ArrayBuffer(44 + dataBytes);
  const view = new DataView(buffer);
  const ascii = (offset: number, text: string): void => {
    for (let i = 0; i < text.length; i += 1)
      view.setUint8(offset + i, text.charCodeAt(i));
  };
  ascii(0, 'RIFF');
  view.setUint32(4, 36 + dataBytes, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  ascii(36, 'data');
  view.setUint32(40, dataBytes, true);
  return new Uint8Array(buffer);
}

function capturingRunner(): { runner: CliRunner; last: () => CliRunInput } {
  let captured: CliRunInput | null = null;
  return {
    runner: async (input) => {
      captured = input;
      return makeWav(22_050); // 1 second
    },
    last: () => {
      if (!captured) throw new Error('runner was not called');
      return captured;
    },
  };
}

describe('CliTtsProvider', () => {
  it('substitutes {model}/{text}/{out} into args and parses the WAV', async () => {
    const { runner, last } = capturingRunner();
    const provider = new CliTtsProvider(
      {
        provider: 'zerotts',
        model: 'zerotts-vi',
        modelVersion: 'v1.2.3',
        voiceId: 'zerotts-vi-default',
        locale: 'vi',
        hardwareClass: 'cpu',
        command: 'zerotts',
        argsTemplate: [
          '--model',
          '{model}',
          '--text',
          '{text}',
          '--out',
          '{out}',
        ],
        textViaStdin: false,
        modelPath: '/models/zerotts/vi',
      },
      runner,
    );

    expect(provider.supportsLocale('vi')).toBe(true);
    expect(provider.supportsLocale('en')).toBe(false);

    const result = await provider.synthesize({
      transcript: 'Xin chào Đầm Sen',
      locale: 'vi',
      voiceId: 'ignored',
      config: {},
      seed: null,
    });

    expect(result.mimeType).toBe('audio/wav');
    expect(result.sampleRateHz).toBe(22_050);
    expect(result.durationSeconds).toBeCloseTo(1, 5);

    const input = last();
    expect(input.command).toBe('zerotts');
    expect(input.stdin).toBeNull();
    expect(input.args.slice(0, 4)).toEqual([
      '--model',
      '/models/zerotts/vi',
      '--text',
      'Xin chào Đầm Sen',
    ]);
    expect(input.args[4]).toBe('--out');
    expect(input.args[5]).toMatch(/\.wav$/);
    expect(input.args[5]).not.toContain('{out}');
  });

  it('pipes the transcript to stdin when textViaStdin is set', async () => {
    const { runner, last } = capturingRunner();
    const provider = new CliTtsProvider(
      {
        provider: 'piper',
        model: 'vi',
        modelVersion: 'v1',
        voiceId: 'vi',
        locale: 'vi',
        hardwareClass: 'cpu',
        command: 'piper',
        argsTemplate: ['--model', '{model}', '--output_file', '{out}'],
        textViaStdin: true,
        modelPath: '/m.onnx',
      },
      runner,
    );
    await provider.synthesize({
      transcript: 'stdin text',
      locale: 'vi',
      voiceId: '',
      config: {},
      seed: null,
    });
    const input = last();
    expect(input.stdin).toBe('stdin text');
    expect(input.args.join(' ')).not.toContain('stdin text');
  });

  it('exposes a stable timeout error code', () => {
    expect(new CliTtsTimeoutError().code).toBe('TTS_TIMEOUT');
  });
});
