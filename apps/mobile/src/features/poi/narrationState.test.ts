import { ApiClientError, type PoiNarration } from '@damsen/api-client';
import { describe, expect, it } from 'vitest';

import { resolveNarrationState } from './narrationState';

const narration: PoiNarration = {
  id: 'narration-1',
  poiId: 'poi-1',
  requestedLocale: 'vi',
  resolvedLocale: 'vi',
  fallbackUsed: false,
  transcript: 'Nội dung thuyết minh đã được duyệt.',
  audio: null,
};

describe('resolveNarrationState', () => {
  it('does not fetch before detail is opened', () => {
    expect(
      resolveNarrationState({
        enabled: false,
        isPending: true,
        error: null,
      }),
    ).toEqual({ status: 'idle' });
  });

  it('returns published narration when ready', () => {
    expect(
      resolveNarrationState({
        enabled: true,
        isPending: false,
        error: null,
        data: narration,
      }),
    ).toEqual({ status: 'ready', narration });
  });

  it('treats a 404 as unavailable and other failures as errors', () => {
    const notFound = new ApiClientError(404, {
      code: 'NOT_FOUND',
      message: 'Not found',
      details: null,
      requestId: 'request-1',
    });
    expect(
      resolveNarrationState({
        enabled: true,
        isPending: false,
        error: notFound,
      }),
    ).toEqual({ status: 'unavailable' });
    expect(
      resolveNarrationState({
        enabled: true,
        isPending: false,
        error: new Error('network'),
      }),
    ).toEqual({ status: 'error' });
  });
});
