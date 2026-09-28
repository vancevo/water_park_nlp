import { DamSenApiClient } from '@damsen/api-client';

import type { NarrationClient } from './narrationModel';

export function createHttpNarrationClient(baseUrl: string): NarrationClient {
  const client = new DamSenApiClient({ baseUrl });
  return {
    getNarration: ({ poiId, locale }) => client.getPoiNarration(poiId, locale),
  };
}
