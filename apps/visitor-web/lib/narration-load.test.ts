import type {
  NarrationLocaleCatalog,
  PoiNarration,
} from '@damsen/shared-types';
import { describe, expect, it } from 'vitest';
import { loadPlayable } from './narration-load';

const catalog: NarrationLocaleCatalog = {
  defaultLocale: 'vi',
  locales: [
    { code: 'vi', nativeLabel: 'Tiếng Việt', speechTag: 'vi-VN' },
    {
      code: 'en',
      nativeLabel: 'English',
      speechTag: 'en-US',
      fallbackLocale: 'vi',
    },
  ],
};
const narration = (over: Partial<PoiNarration> = {}): PoiNarration => ({
  id: 'n1',
  poiId: 'p',
  requestedLocale: 'vi',
  resolvedLocale: 'vi',
  fallbackUsed: false,
  transcript: 'Xin chào',
  audio: {
    playbackUrl: 'https://audio/p.mp3',
  } as PoiNarration['audio'],
  ...over,
});
const base = {
  poiId: 'p',
  poiName: 'Điểm P',
  locale: 'vi',
  catalog,
  source: 'poi-click' as const,
};

describe('loadPlayable', () => {
  it('keys the content by poi, resolved language and narration id', async () => {
    const playable = await loadPlayable({
      ...base,
      getNarration: async () => narration(),
    });
    expect(playable).toMatchObject({
      key: 'p|vi|n1',
      audioUrl: 'https://audio/p.mp3',
      text: 'Xin chào',
      speechLang: 'vi-VN',
    });
    const edited = await loadPlayable({
      ...base,
      getNarration: async () => narration({ id: 'n2' }),
    });
    expect(edited?.key).toBe('p|vi|n2');
  });

  it('is silent for a missing narration unless the visitor asked for it', async () => {
    const missing = async () => {
      throw Object.assign(new Error('no'), { status: 404 });
    };
    expect(await loadPlayable({ ...base, getNarration: missing })).toBeNull();
    expect(
      await loadPlayable({
        ...base,
        source: 'manual',
        fallbackText: 'Mô tả',
        getNarration: missing,
      }),
    ).toMatchObject({ audioUrl: null, text: 'Mô tả', key: 'p|vi|description' });
    expect(
      await loadPlayable({ ...base, source: 'manual', getNarration: missing }),
    ).toBeNull();
  });

  it('never plays another language under the requested one', async () => {
    expect(
      await loadPlayable({
        ...base,
        locale: 'en',
        source: 'manual',
        getNarration: async () =>
          narration({
            requestedLocale: 'en',
            resolvedLocale: 'vi',
            fallbackUsed: true,
          }),
      }),
    ).toBeNull();
  });

  it('lets other errors reach the caller', async () => {
    await expect(
      loadPlayable({
        ...base,
        getNarration: async () => {
          throw new Error('network');
        },
      }),
    ).rejects.toThrow('network');
  });
});
