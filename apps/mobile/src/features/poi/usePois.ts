import { useQuery } from '@tanstack/react-query';

import type { PoiClient, SupportedLocale } from './model';

export function usePois(client: PoiClient, locale: SupportedLocale) {
  return useQuery({
    queryKey: ['pois', locale],
    queryFn: ({ signal }) => client.listPois({ locale, signal }),
    staleTime: 60_000,
    retry: 1,
  });
}
