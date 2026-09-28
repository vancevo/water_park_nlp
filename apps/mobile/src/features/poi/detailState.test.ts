import { describe, expect, it } from 'vitest';

import { resolvePoiDetailState } from './detailState';
import type { PoiDetail } from './model';

const detail: PoiDetail = {
  id: 'poi-1',
  name: 'Vườn Cầu Vồng',
  description: 'Mô tả ngắn',
  categoryName: 'garden',
  latitude: 10.768,
  longitude: 106.635,
  imageUrl: null,
  isOpen: true,
  longDescription: 'Mô tả đầy đủ',
  entrances: [],
  operatingHours: [],
  requestedLocale: 'en',
  resolvedLocale: 'vi',
  fallbackUsed: true,
};

describe('POI detail component state', () => {
  it('stays idle until the visitor asks for detail', () => {
    expect(
      resolvePoiDetailState({
        detailed: false,
        isPending: true,
        isError: false,
      }),
    ).toEqual({ status: 'idle' });
  });

  it('exposes loading, error, and ready states deterministically', () => {
    expect(
      resolvePoiDetailState({
        detailed: true,
        isPending: true,
        isError: false,
      }),
    ).toEqual({ status: 'loading' });
    expect(
      resolvePoiDetailState({
        detailed: true,
        isPending: false,
        isError: true,
      }),
    ).toEqual({ status: 'error' });
    expect(
      resolvePoiDetailState({
        detailed: true,
        isPending: false,
        isError: false,
        data: detail,
      }),
    ).toEqual({ status: 'ready', detail });
  });
});
