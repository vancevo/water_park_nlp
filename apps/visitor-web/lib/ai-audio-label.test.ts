import { describe, expect, it } from 'vitest';
import { aiAudioLabel } from './ai-audio-label';
import { createFixtureNarrationSource } from './narration-source';

const generatedBy = {
  provider: 'piper',
  model: 'vits',
  modelVersion: '1.0',
  voiceId: 'vi-voice',
  license: 'MIT',
  generatedAt: '2026-10-09T00:00:00.000Z',
};

describe('aiAudioLabel', () => {
  it('returns no label for audio without generatedBy', () => {
    expect(aiAudioLabel('vi', undefined)).toBeNull();
  });

  it('labels in the audio language with a matching lang attribute', () => {
    expect(aiAudioLabel('vi', generatedBy)).toMatchObject({
      text: 'Giọng đọc do AI tạo',
      lang: 'vi',
    });
    expect(aiAudioLabel('en', generatedBy)?.text).toBe('AI-generated voice');
  });

  it('falls back to English for locales without a translation', () => {
    expect(aiAudioLabel('de', generatedBy)).toMatchObject({
      text: 'AI-generated voice',
      lang: 'en',
    });
  });

  it('exposes provider and model in the detail without the job id', () => {
    const label = aiAudioLabel('vi', generatedBy);
    expect(label?.detail).toBe('piper · vits 1.0');
    expect(label?.detail).not.toContain('vi-voice');
  });
});

describe('fixture narration provenance', () => {
  it('marks only the VI demo audio as AI-generated', async () => {
    const source = createFixtureNarrationSource(undefined, (locale) =>
      locale === 'vi' ? 'data:audio/wav;base64,AA==' : null,
    );
    expect(
      (await source.getNarration('p1', 'vi')).audio?.generatedBy,
    ).toBeDefined();
    expect((await source.getNarration('p1', 'en')).audio).toBeNull();
  });
});
