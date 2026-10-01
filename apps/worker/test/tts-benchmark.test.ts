import { describe, expect, it } from 'vitest';

import { runTtsBenchmark } from '../src/tts/piper/tts-benchmark.js';
import type { TtsProvider, TtsSynthesisResult } from '../src/tts/types.js';

const SENTENCES = [
  {
    id: 's1',
    locale: 'vi',
    category: 'poi-name',
    text: 'Đầm Sen câu bí mật một.',
  },
  { id: 's2', locale: 'vi', category: 'long', text: 'Đầm Sen câu bí mật hai.' },
  { id: 'skip', locale: 'fr', category: 'poi-name', text: 'Bonjour.' },
];

function okProvider(): TtsProvider {
  return {
    provider: 'piper',
    model: 'vi_VN-vais1000-medium',
    modelVersion: 'piper-voices-v1.0.0',
    supportsLocale: (l) => l === 'vi',
    synthesize: async (): Promise<TtsSynthesisResult> => ({
      audio: new Uint8Array(1000),
      mimeType: 'audio/wav',
      durationSeconds: 2,
      sampleRateHz: 22_050,
    }),
  };
}

describe('runTtsBenchmark', () => {
  it('reports timings, RTF and size for the applicable locale only', async () => {
    // now() is called start/end per sentence: s1 -> 0,400  s2 -> 1000,1800
    const times = [0, 400, 1000, 1800];
    let i = 0;
    const report = await runTtsBenchmark(okProvider(), SENTENCES, {
      voiceId: 'vi_VN-vais1000-medium',
      now: () => times[i++]!,
      timestamp: () => '2026-10-01T00:00:00.000Z',
    });

    expect(report.count).toBe(2); // fr sentence excluded
    expect(report.ok).toBe(2);
    expect(report.failed).toBe(0);
    expect(report.p50GenerationMs).toBe(400);
    expect(report.p95GenerationMs).toBe(800);
    expect(report.meanRealTimeFactor).toBeCloseTo((0.2 + 0.4) / 2, 5);
    expect(report.totalSizeBytes).toBe(2000);
    expect(report.voiceId).toBe('vi_VN-vais1000-medium');
  });

  it('records failures by stable code and never stores transcript text', async () => {
    const failing: TtsProvider = {
      ...okProvider(),
      synthesize: async () => {
        throw Object.assign(new Error('boom'), { code: 'TTS_TIMEOUT' });
      },
    };
    const report = await runTtsBenchmark(failing, SENTENCES, {
      voiceId: 'v',
      timestamp: () => '2026-10-01T00:00:00.000Z',
    });
    expect(report.ok).toBe(0);
    expect(report.failed).toBe(2);
    expect(report.samples.every((s) => s.errorCode === 'TTS_TIMEOUT')).toBe(
      true,
    );
    expect(JSON.stringify(report)).not.toContain('bí mật');
  });
});
