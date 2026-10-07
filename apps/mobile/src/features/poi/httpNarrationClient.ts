import { DamSenApiClient, type PoiNarration } from '@damsen/api-client';

import type { NarrationClient } from './narrationModel';
import {
  isNarrationLocaleCode,
  toNarrationLocaleCode,
} from './narrationLocale';

export class InvalidNarrationResponseError extends Error {
  constructor() {
    super('Narration response is invalid.');
    this.name = 'InvalidNarrationResponseError';
  }
}

/** Accepts any BCP 47 requested/resolved locale; only the shape is checked. */
function assertNarration(value: PoiNarration): PoiNarration {
  if (
    typeof value?.transcript !== 'string' ||
    !isNarrationLocaleCode(value.requestedLocale) ||
    !isNarrationLocaleCode(value.resolvedLocale) ||
    typeof value.fallbackUsed !== 'boolean'
  )
    throw new InvalidNarrationResponseError();
  return value;
}

export function createHttpNarrationClient(baseUrl: string): NarrationClient {
  const client = new DamSenApiClient({ baseUrl });
  return {
    getNarration: async ({ poiId, locale }) =>
      assertNarration(
        await client.getPoiNarration(poiId, toNarrationLocaleCode(locale)),
      ),
  };
}
