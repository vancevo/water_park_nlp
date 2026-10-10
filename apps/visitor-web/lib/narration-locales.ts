import type {
  NarrationLocaleCatalog,
  NarrationLocaleCode,
  NarrationLocaleOption,
  PoiNarration,
} from '@damsen/shared-types';
import type { UiLocale } from './ui-text';

/**
 * App-local port for the public narration-locale catalog (contract v1,
 * `GET /v1/narration-locales`). Narration locale is independent from the UI
 * locale, which stays `vi | en` (ADR 0006/0007).
 */
export interface NarrationLocaleCatalogPort {
  getCatalog(): Promise<NarrationLocaleCatalog>;
}

export const FIXTURE_NARRATION_LOCALE_CATALOG: NarrationLocaleCatalog = {
  defaultLocale: 'vi',
  locales: [
    { code: 'vi', nativeLabel: 'Tiếng Việt', speechTag: 'vi-VN' },
    {
      code: 'en',
      nativeLabel: 'English',
      speechTag: 'en-US',
      fallbackLocale: 'vi',
    },
  ],
};

/** Used only when the catalog cannot be loaded, so transcripts still work. */
export const OFFLINE_NARRATION_LOCALE_CATALOG: NarrationLocaleCatalog = {
  defaultLocale: 'vi',
  locales: FIXTURE_NARRATION_LOCALE_CATALOG.locales.slice(0, 2),
};

export function createFixtureNarrationLocalePort(
  catalog: NarrationLocaleCatalog = FIXTURE_NARRATION_LOCALE_CATALOG,
): NarrationLocaleCatalogPort {
  return { getCatalog: async () => structuredClone(catalog) };
}

export function createHttpNarrationLocalePort(api: {
  getNarrationLocales(): Promise<NarrationLocaleCatalog>;
}): NarrationLocaleCatalogPort {
  return {
    getCatalog: async () => normalizeCatalog(await api.getNarrationLocales()),
  };
}

/** Canonical BCP 47 form via the runtime (no hand-written parser); null if invalid. */
export function canonicalLocale(code: string): NarrationLocaleCode | null {
  try {
    return Intl.getCanonicalLocales(code.trim())[0] ?? null;
  } catch {
    return null;
  }
}

/** Drops malformed/duplicate entries and dangling fallbacks; keeps configured order. */
export function normalizeCatalog(
  catalog: NarrationLocaleCatalog,
): NarrationLocaleCatalog {
  const seen = new Set<string>();
  const locales: NarrationLocaleOption[] = [];
  for (const option of Array.isArray(catalog?.locales) ? catalog.locales : []) {
    const code =
      typeof option?.code === 'string' ? canonicalLocale(option.code) : null;
    if (!code || seen.has(code) || typeof option.nativeLabel !== 'string')
      continue;
    seen.add(code);
    const fallback = option.fallbackLocale
      ? canonicalLocale(option.fallbackLocale)
      : null;
    locales.push({
      code,
      nativeLabel: option.nativeLabel.trim() || code,
      speechTag:
        (typeof option.speechTag === 'string' &&
          canonicalLocale(option.speechTag)) ||
        code,
      ...(fallback ? { fallbackLocale: fallback } : {}),
    });
  }
  for (const option of locales)
    if (
      option.fallbackLocale !== undefined &&
      (!seen.has(option.fallbackLocale) ||
        option.fallbackLocale === option.code)
    )
      delete option.fallbackLocale;
  const requested = canonicalLocale(catalog?.defaultLocale ?? '');
  return {
    defaultLocale:
      requested && seen.has(requested) ? requested : (locales[0]?.code ?? ''),
    locales,
  };
}

export function findLocale(
  catalog: NarrationLocaleCatalog | null | undefined,
  code: NarrationLocaleCode | null | undefined,
): NarrationLocaleOption | undefined {
  return code
    ? catalog?.locales.find((option) => option.code === code)
    : undefined;
}

export function localeLabel(
  catalog: NarrationLocaleCatalog | null | undefined,
  code: NarrationLocaleCode,
): string {
  return findLocale(catalog, code)?.nativeLabel ?? code.toUpperCase();
}

/** Speech tag for Web Speech; falls back to the locale code itself. */
export function speechTagFor(
  catalog: NarrationLocaleCatalog | null | undefined,
  code: NarrationLocaleCode,
): string {
  return findLocale(catalog, code)?.speechTag ?? code;
}

/**
 * Initial narration locale: a stored preference that is still enabled, else the
 * UI locale when the catalog offers it, else the catalog default.
 */
export function resolveInitialNarrationLocale(
  catalog: NarrationLocaleCatalog,
  stored: string | null,
  uiLocale: UiLocale,
): NarrationLocaleCode {
  const preferred = stored ? canonicalLocale(stored) : null;
  if (findLocale(catalog, preferred)) return preferred!;
  if (findLocale(catalog, uiLocale)) return uiLocale;
  return catalog.defaultLocale || catalog.locales[0]?.code || uiLocale;
}

export interface NarrationFallbackNotice {
  requestedLabel: string;
  resolvedLabel: string;
}

/** Non-null when the API served another locale than the one requested. */
export function narrationFallbackNotice(
  catalog: NarrationLocaleCatalog | null | undefined,
  narration: Pick<
    PoiNarration,
    'requestedLocale' | 'resolvedLocale' | 'fallbackUsed'
  > | null,
): NarrationFallbackNotice | null {
  if (!narration) return null;
  if (
    !narration.fallbackUsed &&
    narration.requestedLocale === narration.resolvedLocale
  )
    return null;
  return {
    requestedLabel: localeLabel(catalog, narration.requestedLocale),
    resolvedLabel: localeLabel(catalog, narration.resolvedLocale),
  };
}

export const NARRATION_LOCALE_STORAGE_KEY = 'damsen.visitor.narrationLocale.v1';

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;
function defaultStorage(): StorageLike | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null; // storage disabled (privacy mode, blocked cookies)
  }
}

/** Reads the remembered narration locale; never throws. */
export function readNarrationLocalePreference(
  storage: StorageLike | null = defaultStorage(),
): string | null {
  try {
    const value = storage?.getItem(NARRATION_LOCALE_STORAGE_KEY) ?? null;
    return value && canonicalLocale(value) ? value : null;
  } catch {
    return null;
  }
}

/** Stores only the locale code (no PII); failures are ignored. */
export function saveNarrationLocalePreference(
  code: NarrationLocaleCode,
  storage: StorageLike | null = defaultStorage(),
): boolean {
  const canonical = canonicalLocale(code);
  if (!canonical) return false;
  try {
    storage?.setItem(NARRATION_LOCALE_STORAGE_KEY, canonical);
    return Boolean(storage);
  } catch {
    return false;
  }
}

type VoiceLike = Pick<SpeechSynthesisVoice, 'lang' | 'name'> &
  Partial<Pick<SpeechSynthesisVoice, 'default' | 'localService'>>;

/** macOS/iOS gimmick voices ("Bad News", "Zarvox"...): never pick them for a narration. */
const NOVELTY_VOICES =
  /\b(albert|bad news|bahh|bells|boing|bubbles|cellos|deranged|good news|hysterical|jester|junior|kathy|organ|princess|ralph|superstar|trinoids|whisper|wobble|zarvox|fred|agnes)\b/i;
/** Voices that sound natural: neural/premium builds and well-known good system voices. */
const NATURAL_VOICES =
  /\b(premium|enhanced|natural|neural|online|siri|samantha|alex|ava|allison|susan|serena|daniel|karen|moira|tessa|linh|google)\b/i;

/**
 * Picks a Web Speech voice for a BCP 47 speech tag: exact tag, then same
 * language, and within those the most natural-sounding voice (never a gimmick
 * voice when a normal one exists). Returns null when the device has voices but
 * none for the language.
 */
export function pickSpeechVoice<T extends VoiceLike>(
  voices: readonly T[],
  speechTag: string,
): T | null {
  const normalize = (tag: string) => tag.replace(/_/g, '-').toLowerCase();
  const wanted = normalize(speechTag);
  const language = wanted.split('-')[0];
  let best: T | null = null;
  let bestScore = -Infinity;
  for (const voice of voices) {
    const tag = normalize(voice.lang);
    if (tag.split('-')[0] !== language) continue;
    let score = tag === wanted ? 100 : 0;
    if (NOVELTY_VOICES.test(voice.name)) score -= 1000;
    if (NATURAL_VOICES.test(voice.name)) score += 30;
    if (voice.localService) score += 2;
    if (voice.default) score += 1;
    if (score > bestScore) {
      best = voice;
      bestScore = score;
    }
  }
  return best;
}
