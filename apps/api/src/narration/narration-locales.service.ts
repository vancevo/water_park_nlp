import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import {
  canonicalizeNarrationLocale,
  isNarrationLocaleEnabled,
  listEnabledNarrationLocales,
  narrationLocaleFallbackChain,
  type NarrationLocaleConfig,
} from '@damsen/config';
import type {
  NarrationLocaleCatalog,
  NarrationLocaleCode,
  NarrationLocaleOption,
} from '@damsen/shared-types';

import { NARRATION_LOCALE_CONFIG } from './narration-locales.models.js';

/**
 * Runtime access to the configured narration-locale catalog. Wraps the config
 * from `@damsen/config`, projects the public catalog (enabled locales only, in
 * configured order, with no filesystem details) and enforces enabled-ness at
 * API write boundaries.
 */
@Injectable()
export class NarrationLocalesService {
  constructor(
    @Inject(NARRATION_LOCALE_CONFIG)
    private readonly config: NarrationLocaleConfig,
  ) {}

  /** Public catalog for `GET /v1/narration-locales`. */
  catalog(): NarrationLocaleCatalog {
    return {
      defaultLocale: this.config.defaultLocale,
      locales: listEnabledNarrationLocales(this.config).map(
        (locale): NarrationLocaleOption => ({
          code: locale.code,
          nativeLabel: locale.nativeLabel,
          speechTag: locale.speechTag,
          ...(locale.fallbackLocale
            ? { fallbackLocale: locale.fallbackLocale }
            : {}),
        }),
      ),
    };
  }

  get defaultLocale(): NarrationLocaleCode {
    return this.config.defaultLocale;
  }

  isEnabled(code: NarrationLocaleCode): boolean {
    return isNarrationLocaleEnabled(this.config, code);
  }

  /** Ordered codes to try for a requested locale (requested first, then fallbacks). */
  fallbackChain(code: NarrationLocaleCode): NarrationLocaleCode[] {
    return narrationLocaleFallbackChain(this.config, code);
  }

  /**
   * Resolve a requested locale to the ordered chain of codes to try. Unknown or
   * disabled requested locales fall back to the default locale's chain so a read
   * still resolves to content rather than 404 on a stale locale selection.
   */
  resolveRequest(code: NarrationLocaleCode): {
    requested: NarrationLocaleCode;
    chain: NarrationLocaleCode[];
  } {
    let requested = code;
    try {
      requested = canonicalizeNarrationLocale(code);
    } catch {
      // Keep the raw requested value to echo back to the caller.
    }
    const chain = narrationLocaleFallbackChain(this.config, requested);
    return {
      requested,
      chain:
        chain.length > 0
          ? chain
          : narrationLocaleFallbackChain(
              this.config,
              this.config.defaultLocale,
            ),
    };
  }

  /**
   * Canonicalise and require an enabled locale at a write boundary. Throws
   * `BadRequestException` with a stable code for an unknown or disabled locale.
   */
  requireEnabled(code: NarrationLocaleCode): NarrationLocaleCode {
    let canonical: NarrationLocaleCode;
    try {
      canonical = canonicalizeNarrationLocale(code);
    } catch {
      throw this.disabledLocale(code);
    }
    if (!isNarrationLocaleEnabled(this.config, canonical)) {
      throw this.disabledLocale(code);
    }
    return canonical;
  }

  private disabledLocale(code: NarrationLocaleCode): BadRequestException {
    return new BadRequestException({
      code: 'NARRATION_LOCALE_DISABLED',
      message: `Narration locale "${code}" is not an enabled catalog locale`,
      details: null,
    });
  }
}
