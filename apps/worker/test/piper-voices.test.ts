import { describe, expect, it } from 'vitest';

import {
  buildPiperProvider,
  parsePiperVoiceManifest,
  toTtsModelRegistry,
} from '../src/tts/piper/piper-voices.js';

function manifest(overrides: Record<string, unknown> = {}) {
  return {
    binaryPath: 'piper',
    voices: [
      {
        provider: 'piper',
        model: 'vi_VN-vais1000-medium',
        modelVersion: 'piper-voices-v1.0.0',
        voiceId: 'vi_VN-vais1000-medium',
        locale: 'vi',
        license: 'MIT',
        sourceUrl: 'https://example.test/vi.onnx',
        checksum: 'a'.repeat(64),
        modelPath: 'config/piper-voices/vi.onnx',
        enabled: true,
      },
    ],
    ...overrides,
  };
}

describe('parsePiperVoiceManifest', () => {
  it('accepts a valid manifest', () => {
    const parsed = parsePiperVoiceManifest(manifest());
    expect(parsed.binaryPath).toBe('piper');
    expect(parsed.voices[0]!.voiceId).toBe('vi_VN-vais1000-medium');
    expect(toTtsModelRegistry(parsed).requireForLocale('vi').license).toBe(
      'MIT',
    );
  });

  it('rejects a missing binaryPath or empty voices', () => {
    expect(() => parsePiperVoiceManifest(manifest({ binaryPath: '' }))).toThrow(
      'binaryPath',
    );
    expect(() => parsePiperVoiceManifest(manifest({ voices: [] }))).toThrow(
      'non-empty array',
    );
  });

  it('rejects a non-piper provider, bad checksum and missing model path', () => {
    expect(() =>
      parsePiperVoiceManifest(
        manifest({ voices: [{ ...manifest().voices[0], provider: 'xtts' }] }),
      ),
    ).toThrow('must be "piper"');
    expect(() =>
      parsePiperVoiceManifest(
        manifest({ voices: [{ ...manifest().voices[0], checksum: 'nope' }] }),
      ),
    ).toThrow('checksum');
    expect(() =>
      parsePiperVoiceManifest(
        manifest({ voices: [{ ...manifest().voices[0], modelPath: '' }] }),
      ),
    ).toThrow('modelPath');
  });

  it('builds a provider bound to a voice', () => {
    const parsed = parsePiperVoiceManifest(manifest());
    const provider = buildPiperProvider(parsed, parsed.voices[0]!);
    expect(provider.provider).toBe('piper');
    expect(provider.voiceId).toBe('vi_VN-vais1000-medium');
    expect(provider.supportsLocale('vi')).toBe(true);
  });
});
