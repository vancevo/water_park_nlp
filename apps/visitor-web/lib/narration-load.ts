import type {
  NarrationLocaleCatalog,
  NarrationLocaleCode,
  PoiNarration,
} from '@damsen/shared-types';
import { narrationKey } from './listen-history';
import { speechTagFor } from './narration-locales';
import type { Playable, PlaySource } from './narration-player';
import { getNarrationPorts } from './narration-source';

export interface LoadInput {
  poiId: string;
  poiName: string;
  locale: NarrationLocaleCode;
  catalog: NarrationLocaleCatalog;
  source: PlaySource;
  /** The place's own description, read with the browser voice when there is no narration (manual only). */
  fallbackText?: string | null;
  getNarration?: (
    poiId: string,
    locale: NarrationLocaleCode,
  ) => Promise<PoiNarration>;
}

function isNotFound(cause: unknown): boolean {
  return (
    typeof cause === 'object' &&
    cause !== null &&
    'status' in cause &&
    (cause as { status: unknown }).status === 404
  );
}

/**
 * Fetches what the player should play for a place. The content version is the id of the
 * published narration, so an edited narration is a new thing to hear. Returns null when
 * there is nothing suitable:
 * - no approved narration (an automatic request stays silent; a manual one reads the
 *   place's description with the browser voice, as before);
 * - the narration only exists in another language (never played under the wrong label:
 *   the card offers to switch language instead).
 */
export async function loadPlayable(input: LoadInput): Promise<Playable | null> {
  const get =
    input.getNarration ??
    ((poiId, locale) =>
      getNarrationPorts().narration.getNarration(poiId, locale));
  let narration: PoiNarration;
  try {
    narration = await get(input.poiId, input.locale);
  } catch (cause) {
    if (!isNotFound(cause)) throw cause;
    if (input.source !== 'manual' || !input.fallbackText) return null;
    return {
      key: narrationKey(input.poiId, input.locale, 'description'),
      poiId: input.poiId,
      poiName: input.poiName,
      locale: input.locale,
      audioUrl: null,
      text: input.fallbackText,
      speechLang: speechTagFor(input.catalog, input.locale),
    };
  }
  if (narration.fallbackUsed || narration.resolvedLocale !== input.locale) {
    return null;
  }
  return {
    key: narrationKey(input.poiId, narration.resolvedLocale, narration.id),
    poiId: input.poiId,
    poiName: input.poiName,
    locale: narration.resolvedLocale,
    audioUrl: narration.audio?.playbackUrl ?? null,
    text: narration.transcript,
    speechLang: speechTagFor(input.catalog, narration.resolvedLocale),
  };
}
