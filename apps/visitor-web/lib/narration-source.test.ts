import { describe, expect, it } from 'vitest';
import { createDemoToneWav, createDemoToneWavUrl } from './demo-audio';
import {
  NarrationNotFoundError,
  createFixtureNarrationSource,
  narrationDataMode,
} from './narration-source';

describe('fixture narration source', () => {
  const source = createFixtureNarrationSource(undefined, (locale) =>
    locale === 'vi' ? 'data:audio/wav;base64,AA==' : null,
  );

  it('serves VI with recorded audio and EN transcript-only', async () => {
    const vi = await source.getNarration('p1', 'vi');
    expect(vi).toMatchObject({ resolvedLocale: 'vi', fallbackUsed: false });
    expect(vi.audio?.playbackUrl).toBe('data:audio/wav;base64,AA==');
    const en = await source.getNarration('p1', 'en');
    expect(en.audio).toBeNull();
  });

  it('follows the catalog fallback chain for a locale without content', async () => {
    expect(await source.getNarration('p1', 'de')).toMatchObject({
      requestedLocale: 'de',
      resolvedLocale: 'vi',
      fallbackUsed: true,
    });
  });

  it('reports a missing narration as not found', async () => {
    const empty = createFixtureNarrationSource({
      defaultLocale: 'fr',
      locales: [{ code: 'fr', nativeLabel: 'Français', speechTag: 'fr-FR' }],
    });
    await expect(empty.getNarration('p1', 'fr')).rejects.toBeInstanceOf(
      NarrationNotFoundError,
    );
  });

  it('selects demo data only when explicitly requested', () => {
    expect(narrationDataMode('demo')).toBe('demo');
    expect(narrationDataMode(undefined)).toBe('api');
  });

  it('generates a playable WAV data URL', () => {
    expect(String.fromCharCode(...createDemoToneWav(0.01).slice(0, 4))).toBe(
      'RIFF',
    );
    expect(createDemoToneWavUrl()).toMatch(/^data:audio\/wav;base64,UklGR/);
  });
});
