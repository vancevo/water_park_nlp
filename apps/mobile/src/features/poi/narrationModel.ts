import type { NarrationLocaleCode, PoiNarration } from '@damsen/api-client';

export interface NarrationClient {
  getNarration(input: {
    poiId: string;
    /** Any BCP 47 narration locale from the catalog; not limited to the UI locale. */
    locale: NarrationLocaleCode;
    signal?: AbortSignal;
  }): Promise<PoiNarration>;
}

export type NarrationState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'unavailable' }
  | { status: 'error' }
  | { status: 'ready'; narration: PoiNarration };
