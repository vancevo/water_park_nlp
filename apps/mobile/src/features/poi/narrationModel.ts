import type { PoiNarration, SupportedLocale } from '@damsen/api-client';

export interface NarrationClient {
  getNarration(input: {
    poiId: string;
    locale: SupportedLocale;
    signal?: AbortSignal;
  }): Promise<PoiNarration>;
}

export type NarrationState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'unavailable' }
  | { status: 'error' }
  | { status: 'ready'; narration: PoiNarration };
