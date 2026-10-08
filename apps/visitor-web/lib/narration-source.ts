import type {
  NarrationLocaleCatalog,
  NarrationLocaleCode,
  PoiNarration,
} from '@damsen/shared-types';
import { visitorApi } from './api';
import { createDemoToneWavUrl } from './demo-audio';
import {
  FIXTURE_NARRATION_LOCALE_CATALOG,
  createFixtureNarrationLocalePort,
  createHttpNarrationLocalePort,
  findLocale,
  type NarrationLocaleCatalogPort,
} from './narration-locales';

/** App-local port for `GET /v1/pois/:poiId/narration?locale=<code>`. */
export interface NarrationSourcePort {
  getNarration(
    poiId: string,
    locale: NarrationLocaleCode,
  ): Promise<PoiNarration>;
}

export class NarrationNotFoundError extends Error {
  readonly status = 404;
  constructor() {
    super('Chưa có thuyết minh được duyệt.');
    this.name = 'NarrationNotFoundError';
  }
}

/**
 * Demo content (synthetic, written for this project): VI has a generated tone
 * as "recorded audio", EN is transcript-only (Web Speech), FR is missing so the
 * catalog fallback chain (fr → en) and the fallback indicator are exercised.
 */
const DEMO_TRANSCRIPTS: Record<string, string> = {
  vi: 'Bản thuyết minh minh hoạ (dữ liệu demo). Điểm tham quan này phù hợp cho cả gia đình; hãy đi chậm và quan sát biển chỉ dẫn.',
  en: 'Demo narration (synthetic data). This stop suits the whole family; walk slowly and follow the signs.',
};

export function createFixtureNarrationSource(
  catalog: NarrationLocaleCatalog = FIXTURE_NARRATION_LOCALE_CATALOG,
  audioUrl: (locale: string) => string | null = (locale) =>
    locale === 'vi' ? createDemoToneWavUrl() : null,
): NarrationSourcePort {
  return {
    async getNarration(poiId, requestedLocale) {
      const visited = new Set<string>();
      let current: string | undefined = findLocale(catalog, requestedLocale)
        ? requestedLocale
        : catalog.defaultLocale;
      while (current && !visited.has(current)) {
        visited.add(current);
        const transcript = DEMO_TRANSCRIPTS[current];
        if (transcript) {
          const url = audioUrl(current);
          return {
            id: `demo-${poiId}-${current}`,
            poiId,
            requestedLocale,
            resolvedLocale: current,
            fallbackUsed: current !== requestedLocale,
            transcript,
            audio: url
              ? {
                  mimeType: 'audio/wav',
                  sizeBytes: 0,
                  sha256: '0'.repeat(64),
                  durationSeconds: 1.2,
                  rightsOwner: 'Demo fixture',
                  rightsSource: 'Synthetic tone generated in the browser',
                  usageRights: 'Demo only',
                  playbackUrl: url,
                  playbackExpiresAt: '2099-01-01T00:00:00.000Z',
                }
              : null,
          };
        }
        current = findLocale(catalog, current)?.fallbackLocale;
      }
      throw new NarrationNotFoundError();
    },
  };
}

export type NarrationDataMode = 'api' | 'demo';
export function narrationDataMode(
  value = process.env.NEXT_PUBLIC_NARRATION_DATA_MODE,
): NarrationDataMode {
  return value === 'demo' || value === 'test' ? 'demo' : 'api';
}

let ports:
  | { catalog: NarrationLocaleCatalogPort; narration: NarrationSourcePort }
  | undefined;

/** Fixture adapters for an explicit demo, otherwise the typed API client. */
export function getNarrationPorts() {
  ports ??=
    narrationDataMode() === 'demo'
      ? {
          catalog: createFixtureNarrationLocalePort(),
          narration: createFixtureNarrationSource(),
        }
      : {
          catalog: createHttpNarrationLocalePort(visitorApi),
          narration: {
            getNarration: (poiId: string, locale: NarrationLocaleCode) =>
              visitorApi.getPoiNarration(poiId, locale),
          },
        };
  return ports;
}
