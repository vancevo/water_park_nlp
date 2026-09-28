import { ApiClientError, type PoiNarration } from '@damsen/api-client';

import type { NarrationState } from './narrationModel';

interface NarrationQuerySnapshot {
  enabled: boolean;
  isPending: boolean;
  error: unknown;
  data?: PoiNarration;
}

export function resolveNarrationState({
  enabled,
  isPending,
  error,
  data,
}: NarrationQuerySnapshot): NarrationState {
  if (!enabled) return { status: 'idle' };
  if (error instanceof ApiClientError && error.status === 404) {
    return { status: 'unavailable' };
  }
  if (error) return { status: 'error' };
  if (isPending || !data) return { status: 'loading' };
  return { status: 'ready', narration: data };
}
