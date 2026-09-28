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
});
