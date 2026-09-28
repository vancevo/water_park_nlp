import { useQuery } from '@tanstack/react-query';

import type { PoiClient, SupportedLocale } from './model';

export function usePoiDetail(
  client: PoiClient,
  id: string | null,
  locale: SupportedLocale,
  enabled: boolean,
) {
  return useQuery({
    queryKey: ['poi', id, locale],
    queryFn: ({ signal }) => {
      if (!id) throw new Error('A POI id is required.');
      return client.getPoi({ id, locale, signal });
    },
    enabled: enabled && id !== null,
    staleTime: 60_000,
    retry: 1,
  });
}
