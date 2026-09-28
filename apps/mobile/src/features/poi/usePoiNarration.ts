import { useQuery } from '@tanstack/react-query';

import type { NarrationClient } from './narrationModel';
import type { SupportedLocale } from './model';

export function usePoiNarration(
  client: NarrationClient,
  poiId: string | null,
  locale: SupportedLocale,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ['poi-narration', poiId, locale],
    queryFn: ({ signal }) =>
      client.getNarration({ poiId: poiId!, locale, signal }),
    enabled: enabled && poiId !== null,
    retry: false,
    staleTime: 0,
    // Signed playback URLs are sensitive, short-lived credentials. Never retain
    // them after the detail observer unmounts; a future audio-file cache must be
    // keyed by sha256 and contain only downloaded bytes, never the signed URL.
    gcTime: 0,
  });
}
