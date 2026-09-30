import { describe, expect, it } from 'vitest';
import { parseNarrationLocaleConfig } from '@damsen/config';

import { InMemoryPoiRepository } from '../src/poi/in-memory-poi.repository.js';
import { InMemoryNarrationRepository } from '../src/narration/in-memory-narration.repository.js';
import { UnavailableMediaStorage } from '../src/narration/media-storage.js';
import type { NarrationRecord } from '../src/narration/narration.models.js';
import { NarrationLocalesService } from '../src/narration/narration-locales.service.js';
import { NarrationService } from '../src/narration/narration.service.js';

const POI_ID = '00000000-0000-4000-8000-000000000101';
const NOW = new Date('2026-01-01T00:00:00.000Z');

function published(locale: string, id: string): NarrationRecord {
  return {
    id,
    poiId: POI_ID,
    locale,
    revision: 1,
    transcript: 'A reviewed transcript for testing locale fallback.',
    status: 'published',
    audio: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function service(seed: NarrationRecord[]): NarrationService {
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
    ],
  });
  return new NarrationService(
    new InMemoryNarrationRepository(seed),
    new InMemoryPoiRepository(),
    () => NOW,
    new UnavailableMediaStorage(),
    new NarrationLocalesService(config),
  );
}

describe('NarrationService locale fallback', () => {
  it('returns the exact locale without a fallback when present', async () => {
    const result = await service([
      published('vi', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
      published('en', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
    ]).published(POI_ID, 'vi');
    expect(result.requestedLocale).toBe('vi');
    expect(result.resolvedLocale).toBe('vi');
    expect(result.fallbackUsed).toBe(false);
  });

  it('walks the fallback chain when the requested locale is missing', async () => {
    const result = await service([
      published('en', 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),
    ]).published(POI_ID, 'fr');
    expect(result.requestedLocale).toBe('fr');
    expect(result.resolvedLocale).toBe('en');
    expect(result.fallbackUsed).toBe(true);
  });

  it('falls back to the default locale for an unknown requested locale', async () => {
    const result = await service([
      published('vi', 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'),
    ]).published(POI_ID, 'zz');
    expect(result.requestedLocale).toBe('zz');
    expect(result.resolvedLocale).toBe('vi');
    expect(result.fallbackUsed).toBe(true);
  });

  it('rejects creating a narration in a disabled locale', async () => {
    await expect(
      service([]).create(
        POI_ID,
        { locale: 'de', transcript: 'z'.repeat(30), audio: null },
        'ffffffff-ffff-4fff-8fff-ffffffffffff',
      ),
    ).rejects.toThrow('not an enabled catalog locale');
  });
});
