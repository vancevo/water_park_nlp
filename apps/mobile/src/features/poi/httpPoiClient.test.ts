import { afterEach, describe, expect, it, vi } from 'vitest';

import { createHttpPoiClient, PoiRequestError } from './httpPoiClient';

const detailPayload = {
  id: 'poi/1',
  slug: 'vuon-cau-vong',
  category: 'garden',
  location: { latitude: 10.768, longitude: 106.635 },
  requestedLocale: 'en',
  resolvedLocale: 'vi',
  fallbackUsed: true,
  name: 'Vườn Cầu Vồng',
  shortDescription: 'Vườn hoa nhiều màu sắc.',
  longDescription: 'Nội dung thuyết minh đầy đủ.',
  isOpen: true,
  entrances: [
    {
      id: 'entrance-1',
      label: 'Cổng chính',
      location: { latitude: 10.7681, longitude: 106.6351 },
      graphNodeRef: 'N1',
      isPrimary: true,
      accessibility: 'step_free',
    },
  ],
  operatingHours: [{ dayOfWeek: 1, opensAt: '08:00', closesAt: '18:00' }],
};

afterEach(() => vi.unstubAllGlobals());

describe('HTTP POI detail client', () => {
  it('fetches the localized detail and normalizes nested fields', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify(detailPayload), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const controller = new AbortController();
    const detail = await createHttpPoiClient('https://api.example').getPoi({
      id: 'poi/1',
      locale: 'en',
      signal: controller.signal,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.example/v1/pois/poi%2F1?locale=en',
      expect.objectContaining({ signal: controller.signal }),
    );
    expect(detail).toMatchObject({
      fallbackUsed: true,
      requestedLocale: 'en',
      resolvedLocale: 'vi',
      longDescription: 'Nội dung thuyết minh đầy đủ.',
      entrances: [
        expect.objectContaining({
          label: 'Cổng chính',
          isPrimary: true,
          accessibility: 'step_free',
        }),
      ],
      operatingHours: [{ dayOfWeek: 1, opensAt: '08:00', closesAt: '18:00' }],
    });
  });

  it('rejects malformed detail at the adapter boundary', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(
            JSON.stringify({ ...detailPayload, operatingHours: 'invalid' }),
            { status: 200, headers: { 'Content-Type': 'application/json' } },
          ),
        ),
    );

    await expect(
      createHttpPoiClient('https://api.example').getPoi({
        id: 'poi-1',
        locale: 'vi',
      }),
    ).rejects.toBeInstanceOf(PoiRequestError);
  });

  it('preserves the HTTP status when detail loading fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('{}', { status: 404 })),
    );

    await expect(
      createHttpPoiClient('https://api.example').getPoi({
        id: 'missing',
        locale: 'vi',
      }),
    ).rejects.toMatchObject({ status: 404 });
  });
});
