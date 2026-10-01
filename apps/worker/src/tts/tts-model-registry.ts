import type { TtsModelRegistryEntry } from './types.js';

export class TtsModelRegistryError extends Error {
  constructor(message: string) {
    super(`tts model registry: ${message}`);
    this.name = 'TtsModelRegistryError';
  }
}

const SHA256 = /^[0-9a-f]{64}$/;

/**
 * Immutable registry of provider/model/voice artifacts. Each entry must carry an
 * explicit license, source URL and pinned checksum — license is never inferred
 * from a repository. Locale lookup returns only enabled entries.
 */
export class TtsModelRegistry {
  private readonly entries: readonly TtsModelRegistryEntry[];

  constructor(entries: readonly TtsModelRegistryEntry[]) {
    const seen = new Set<string>();
    for (const entry of entries) {
      requireNonEmpty(entry.provider, 'provider');
      requireNonEmpty(entry.model, 'model');
      requireNonEmpty(entry.modelVersion, 'modelVersion');
      requireNonEmpty(entry.voiceId, 'voiceId');
      requireNonEmpty(entry.locale, 'locale');
      requireNonEmpty(entry.license, 'license');
      requireNonEmpty(entry.sourceUrl, 'sourceUrl');
      if (!SHA256.test(entry.checksum)) {
        throw new TtsModelRegistryError(
          `entry ${entry.model}@${entry.modelVersion} has an invalid checksum`,
        );
      }
      if (entry.modelVersion === 'main' || entry.modelVersion === 'latest') {
        throw new TtsModelRegistryError(
          `entry ${entry.model} must pin an immutable modelVersion, not "${entry.modelVersion}"`,
        );
      }
      const key = `${entry.provider}\u0000${entry.model}\u0000${entry.modelVersion}\u0000${entry.voiceId}`;
      if (seen.has(key)) {
        throw new TtsModelRegistryError(
          `duplicate entry ${entry.provider}/${entry.model}/${entry.voiceId}`,
        );
      }
      seen.add(key);
    }
    this.entries = entries;
  }

  /** First enabled voice serving the given locale, or null. */
  enabledForLocale(locale: string): TtsModelRegistryEntry | null {
    return (
      this.entries.find((entry) => entry.enabled && entry.locale === locale) ??
      null
    );
  }

  /** Enabled voice for the locale, or throw a stable error. */
  requireForLocale(locale: string): TtsModelRegistryEntry {
    const entry = this.enabledForLocale(locale);
    if (!entry) {
      throw new TtsModelRegistryError(
        `no enabled voice for locale "${locale}"`,
      );
    }
    return entry;
  }

  get(
    provider: string,
    model: string,
    modelVersion: string,
    voiceId: string,
  ): TtsModelRegistryEntry | null {
    return (
      this.entries.find(
        (entry) =>
          entry.provider === provider &&
          entry.model === model &&
          entry.modelVersion === modelVersion &&
          entry.voiceId === voiceId,
      ) ?? null
    );
  }

  list(): readonly TtsModelRegistryEntry[] {
    return this.entries;
  }
}

function requireNonEmpty(value: string, field: string): void {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TtsModelRegistryError(`${field} must be a non-empty string`);
  }
}
