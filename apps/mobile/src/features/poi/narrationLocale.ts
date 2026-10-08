import type { NarrationLocaleCode } from '@damsen/api-client';

/** Minimal BCP 47 shape used only when the runtime lacks Intl.getCanonicalLocales. */
const BCP47_SHAPE =
  /^[a-z]{2,3}(-[a-z]{4})?(-([a-z]{2}|\d{3}))?(-[a-z\d]{5,8}|-\d[a-z\d]{3})*$/i;
const MAX_LENGTH = 35;

export class InvalidNarrationLocaleError extends Error {
  constructor() {
    super('Narration locale is not a valid BCP 47 tag.');
    this.name = 'InvalidNarrationLocaleError';
  }
}

/**
 * Canonicalises a narration locale (any BCP 47 tag from the server catalog,
 * not just vi|en). Uses the runtime's Intl implementation; Hermes builds
 * without it fall back to case normalisation of a minimal tag shape.
 */
export function toNarrationLocaleCode(value: string): NarrationLocaleCode {
  const trimmed = value.trim().replace(/_/g, '-');
  if (!trimmed || trimmed.length > MAX_LENGTH)
    throw new InvalidNarrationLocaleError();
  const intl = Intl as { getCanonicalLocales?: (tag: string) => string[] };
  if (typeof intl.getCanonicalLocales === 'function') {
    try {
      const [canonical] = intl.getCanonicalLocales(trimmed);
      if (canonical) return canonical;
    } catch {
      throw new InvalidNarrationLocaleError();
    }
  }
  if (!BCP47_SHAPE.test(trimmed)) throw new InvalidNarrationLocaleError();
  return trimmed
    .split('-')
    .map((part, index) => {
      if (index === 0) return part.toLowerCase();
      if (part.length === 4 && /^[a-z]+$/i.test(part))
        return part[0]!.toUpperCase() + part.slice(1).toLowerCase();
      if (part.length === 2) return part.toUpperCase();
      return part.toLowerCase();
    })
    .join('-');
}

export function isNarrationLocaleCode(
  value: unknown,
): value is NarrationLocaleCode {
  if (typeof value !== 'string') return false;
  try {
    toNarrationLocaleCode(value);
    return true;
  } catch {
    return false;
  }
}
