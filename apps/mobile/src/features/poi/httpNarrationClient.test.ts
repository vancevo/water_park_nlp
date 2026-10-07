import { afterEach, describe, expect, it, vi } from 'vitest';

import { createHttpNarrationClient } from './httpNarrationClient';

afterEach(() => vi.unstubAllGlobals());

describe('HTTP narration client', () => {
  it('requests the exact POI locale and returns published narration', async () => {
    const payload = {
      id: 'narration-1',
      poiId: 'poi/one',
      requestedLocale: 'en',
      resolvedLocale: 'en',
      fallbackUsed: false,
      transcript: 'A reviewed English narration.',
      audio: null,
    };
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(payload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const result = await createHttpNarrationClient(
      'https://api.example/',
    ).getNarration({ poiId: 'poi/one', locale: 'en' });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example/v1/pois/poi%2Fone/narration?locale=en',
      expect.objectContaining({ method: 'GET' }),
    );
    expect(result).toEqual(payload);
  });

  it('passes any BCP 47 narration locale and accepts a fallback response', async () => {
    const payload = {
      id: 'narration-2',
      poiId: 'poi-1',
      requestedLocale: 'fr',
      resolvedLocale: 'en',
      fallbackUsed: true,
      transcript: 'Fallback English narration.',
      audio: null,
    };
    const fetchMock = vi.fn().mockImplementation(
      async () =>
        new Response(JSON.stringify(payload), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const client = createHttpNarrationClient('https://api.example');
    await expect(
      client.getNarration({ poiId: 'poi-1', locale: 'fr' }),
    ).resolves.toEqual(payload);
    await client.getNarration({ poiId: 'poi-1', locale: 'zh-hant-tw' });
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      'https://api.example/v1/pois/poi-1/narration?locale=zh-Hant-TW',
    );
  });

  it('rejects an invalid locale before calling the network', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      createHttpNarrationClient('https://api.example').getNarration({
        poiId: 'poi-1',
        locale: 'not a locale',
      }),
    ).rejects.toThrow('BCP 47');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('rejects malformed narration payloads', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            transcript: 'x',
            requestedLocale: 'fr',
            resolvedLocale: '',
            fallbackUsed: false,
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        ),
      ),
    );
    await expect(
      createHttpNarrationClient('https://api.example').getNarration({
        poiId: 'poi-1',
        locale: 'fr',
      }),
    ).rejects.toThrow('Narration response is invalid.');
  });
});
