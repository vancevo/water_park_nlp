import { describe, expect, it } from 'vitest';

import { parseWav } from '../src/tts/piper/wav.js';

function ascii(buf: Uint8Array, offset: number, text: string): void {
  for (let i = 0; i < text.length; i += 1) buf[offset + i] = text.charCodeAt(i);
}

function buildWav({
  sampleRate = 22_050,
  channels = 1,
  bits = 16,
  samples = 22_050,
} = {}): Uint8Array {
  const dataBytes = samples * channels * (bits / 8);
  const buf = new Uint8Array(44 + dataBytes);
  const dv = new DataView(buf.buffer);
  ascii(buf, 0, 'RIFF');
  dv.setUint32(4, 36 + dataBytes, true);
  ascii(buf, 8, 'WAVE');
  ascii(buf, 12, 'fmt ');
  dv.setUint32(16, 16, true);
  dv.setUint16(20, 1, true);
  dv.setUint16(22, channels, true);
  dv.setUint32(24, sampleRate, true);
  dv.setUint32(28, (sampleRate * channels * bits) / 8, true);
  dv.setUint16(32, (channels * bits) / 8, true);
  dv.setUint16(34, bits, true);
  ascii(buf, 36, 'data');
  dv.setUint32(40, dataBytes, true);
  return buf;
}

describe('parseWav', () => {
  it('reads sample rate and duration from a PCM WAV', () => {
    const info = parseWav(buildWav({ sampleRate: 22_050, samples: 22_050 }));
    expect(info.sampleRateHz).toBe(22_050);
    expect(info.channels).toBe(1);
    expect(info.bitsPerSample).toBe(16);
    expect(info.durationSeconds).toBeCloseTo(1.0, 3);
  });

  it('computes a fractional duration', () => {
    const info = parseWav(buildWav({ sampleRate: 16_000, samples: 8_000 }));
    expect(info.durationSeconds).toBeCloseTo(0.5, 3);
  });

  it('rejects a non-WAV buffer and a missing fmt chunk', () => {
    expect(() => parseWav(new Uint8Array(8))).toThrow('RIFF/WAVE');
    const noFmt = new Uint8Array(12);
    ascii(noFmt, 0, 'RIFF');
    ascii(noFmt, 8, 'WAVE');
    expect(() => parseWav(noFmt)).toThrow('missing fmt');
  });
});
