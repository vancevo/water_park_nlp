/**
 * DI token for the validated narration-locale config. Provided via a factory
 * that loads and validates the catalog at module init, so an invalid config
 * fails API startup instead of serving a broken catalog.
 */
export const NARRATION_LOCALE_CONFIG = Symbol('NARRATION_LOCALE_CONFIG');
