import { DamSenApiClient } from '@damsen/api-client';
import type {
  AdminNarration,
  NarrationLocaleCatalog,
  NarrationLocaleCode,
  NarrationLocaleOption,
} from '@damsen/shared-types';
import { apiBase } from './api-poi-client';

/**
 * App-local port for the public narration-locale catalog (contract v1,
 * `GET /v1/narration-locales`). The UI depends on this port only, so the
 * fixture adapter can be swapped for the HTTP adapter at integration I01.
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

export function createFixtureNarrationLocalePort(
  catalog: NarrationLocaleCatalog = FIXTURE_NARRATION_LOCALE_CATALOG,
): NarrationLocaleCatalogPort {
  return { getCatalog: async () => structuredClone(catalog) };
}

export function createHttpNarrationLocalePort(
  api: Pick<DamSenApiClient, 'getNarrationLocales'>,
): NarrationLocaleCatalogPort {
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

/**
 * Defensive normalisation at the client boundary: drops malformed or duplicate
 * entries and fallbacks that do not resolve, and keeps the configured order.
 * The API already validates; this only stops a bad payload from breaking UI.
 */
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
    locales.push({
      code,
      nativeLabel: option.nativeLabel.trim() || code,
      speechTag:
        (typeof option.speechTag === 'string' &&
          canonicalLocale(option.speechTag)) ||
        code,
      ...(option.fallbackLocale
        ? { fallbackLocale: canonicalLocale(option.fallbackLocale) ?? '' }
        : {}),
    });
  }
  for (const option of locales) {
    if (
      option.fallbackLocale !== undefined &&
      (!seen.has(option.fallbackLocale) ||
        option.fallbackLocale === option.code)
    )
      delete option.fallbackLocale;
  }
  const requestedDefault = canonicalLocale(catalog?.defaultLocale ?? '');
  const defaultLocale =
    requestedDefault && seen.has(requestedDefault)
      ? requestedDefault
      : (locales[0]?.code ?? '');
  return { defaultLocale, locales };
}

export function findLocale(
  catalog: NarrationLocaleCatalog | null | undefined,
  code: NarrationLocaleCode,
): NarrationLocaleOption | undefined {
  return catalog?.locales.find((option) => option.code === code);
}

export function localeLabel(
  catalog: NarrationLocaleCatalog | null | undefined,
  code: NarrationLocaleCode,
): string {
  return findLocale(catalog, code)?.nativeLabel ?? code.toUpperCase();
}

/** Requested locale followed by its fallbacks; stops on unknown codes and cycles. */
export function fallbackChain(
  catalog: NarrationLocaleCatalog,
  code: NarrationLocaleCode,
): NarrationLocaleCode[] {
  const chain: NarrationLocaleCode[] = [];
  let current: NarrationLocaleCode | undefined = code;
  while (current && !chain.includes(current) && findLocale(catalog, current)) {
    chain.push(current);
    current = findLocale(catalog, current)?.fallbackLocale;
  }
  return chain;
}

/** Narration locales stored on this POI that the catalog no longer enables. */
export function disabledStoredLocales(
  catalog: NarrationLocaleCatalog,
  narrations: Pick<AdminNarration, 'locale'>[],
): NarrationLocaleCode[] {
  const enabled = new Set(catalog.locales.map((option) => option.code));
  return [...new Set(narrations.map((item) => item.locale))]
    .filter((code) => !enabled.has(code))
    .sort();
}

export type NarrationDataMode = 'api' | 'demo';

export function narrationDataMode(
  value = process.env.NEXT_PUBLIC_NARRATION_DATA_MODE,
): NarrationDataMode {
  return value === 'demo' || value === 'test' ? 'demo' : 'api';
}

let catalogPort: NarrationLocaleCatalogPort | undefined;
export function getNarrationLocalePort(): NarrationLocaleCatalogPort {
  catalogPort ??=
    narrationDataMode() === 'demo'
      ? createFixtureNarrationLocalePort()
      : createHttpNarrationLocalePort(
          new DamSenApiClient({ baseUrl: apiBase }),
        );
  return catalogPort;
}
