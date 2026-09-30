import { describe, expect, it } from 'vitest';
import { parseNarrationLocaleConfig } from '@damsen/config';

import { NarrationLocalesService } from '../src/narration/narration-locales.service.js';

function service(): NarrationLocalesService {
  const config = parseNarrationLocaleConfig({
    defaultLocale: 'vi',
    locales: [
      { code: 'vi', nativeLabel: 'Tiếng Việt', speechTag: 'vi-VN' },
      {
        code: 'en',
        nativeLabel: 'English',
        speechTag: 'en-US',
        fallbackLocale: 'vi',
      },
      {
        code: 'fr',
        nativeLabel: 'Français',
        speechTag: 'fr-FR',
        fallbackLocale: 'en',
      },
      {
        code: 'de',
        nativeLabel: 'Deutsch',
        speechTag: 'de-DE',
        enabled: false,
      },
    ],
  });
  return new NarrationLocalesService(config);
}

describe('NarrationLocalesService', () => {
  it('projects only enabled locales, in order, without disabled entries', () => {
    const catalog = service().catalog();
    expect(catalog.defaultLocale).toBe('vi');
    expect(catalog.locales.map((l) => l.code)).toEqual(['vi', 'en', 'fr']);
    expect(catalog.locales[0]!).toEqual({
      code: 'vi',
      nativeLabel: 'Tiếng Việt',
      speechTag: 'vi-VN',
    });
    expect(catalog.locales[1]!.fallbackLocale).toBe('vi');
    expect(JSON.stringify(catalog)).not.toContain('config/');
  });

  it('reports enabled status and fallback chains', () => {
    const s = service();
    expect(s.isEnabled('FR')).toBe(true);
    expect(s.isEnabled('de')).toBe(false);
    expect(s.fallbackChain('fr')).toEqual(['fr', 'en', 'vi']);
  });

  it('resolves a requested locale to the chain to try', () => {
    const s = service();
    expect(s.resolveRequest('fr')).toEqual({
      requested: 'fr',
      chain: ['fr', 'en', 'vi'],
    });
    // Unknown/disabled requested locales fall back to the default chain.
    expect(s.resolveRequest('de')).toEqual({
      requested: 'de',
      chain: ['vi'],
    });
    expect(s.resolveRequest('zz')).toEqual({
      requested: 'zz',
      chain: ['vi'],
    });
  });

  it('requires an enabled locale at write boundaries', () => {
    const s = service();
    expect(s.requireEnabled('EN')).toBe('en');
    expect(() => s.requireEnabled('de')).toThrow(
      'not an enabled catalog locale',
    );
    expect(() => s.requireEnabled('zz')).toThrow(
      'not an enabled catalog locale',
    );
  });
});
