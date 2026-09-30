import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Configurable narration-locale catalog (T25A / C02).
 *
 * The API is the runtime source of truth for narration locales. It reads one
 * validated JSON file (default `config/narration-locales.json`, overridable via
 * `NARRATION_LOCALES_CONFIG_PATH`). Adding, disabling or reordering a narration
 * locale is a config + redeploy change only — no TypeScript union, DTO, SQL
 * constraint or UI edit. `vi` and `en` must always be present and enabled for
 * backward compatibility.
 *
 * This module owns parsing, canonicalisation and validation only. Projecting the
 * config to the public `NarrationLocaleCatalog` contract and enforcing it at API
 * write boundaries lives in `apps/api`.
 */

/** Maximum length of a canonical BCP 47 tag we accept in config. */
export const MAX_NARRATION_LOCALE_CODE_LENGTH = 35;

/** Environment variable that overrides the default config file path. */
export const NARRATION_LOCALES_CONFIG_PATH_ENV =
  'NARRATION_LOCALES_CONFIG_PATH';

/** Default config path, resolved against the process working directory. */
export const DEFAULT_NARRATION_LOCALES_CONFIG_PATH =
  'config/narration-locales.json';

/** Locales that must always be present and enabled for backward compatibility. */
export const REQUIRED_NARRATION_LOCALES = ['vi', 'en'] as const;

export interface NarrationLocaleConfigEntry {
  /** Canonical BCP 47 tag, e.g. `vi`, `en`, `fr`. */
  code: string;
  /** Label shown in the locale's own language, e.g. `Tiếng Việt`. */
  nativeLabel: string;
  /** Web Speech / speechSynthesis tag, e.g. `vi-VN`. */
  speechTag: string;
  /** Whether the locale is offered publicly and accepts new content. */
  enabled: boolean;
  /** Canonical code of the locale to fall back to, or `null`. */
  fallbackLocale: string | null;
}

export interface NarrationLocaleConfig {
  /** Canonical code of the default locale; must be enabled. */
  defaultLocale: string;
  /** Locales in display order (file order is preserved). */
  locales: NarrationLocaleConfigEntry[];
}

/**
 * Built-in default used when no config file is configured or found. Guarantees
 * `vi`/`en` keep working even before an operator ships a config file.
 */
export const DEFAULT_NARRATION_LOCALE_CONFIG: NarrationLocaleConfig = {
  defaultLocale: 'vi',
  locales: [
    {
      code: 'vi',
      nativeLabel: 'Tiếng Việt',
      speechTag: 'vi-VN',
      enabled: true,
      fallbackLocale: null,
    },
    {
      code: 'en',
      nativeLabel: 'English',
      speechTag: 'en-US',
      enabled: true,
      fallbackLocale: 'vi',
    },
  ],
};

export class NarrationLocaleConfigError extends Error {
  constructor(message: string) {
    super(`narration-locales config: ${message}`);
    this.name = 'NarrationLocaleConfigError';
  }
}

/**
 * Canonicalise a single BCP 47 tag using the platform Intl implementation.
 * Throws {@link NarrationLocaleConfigError} for structurally invalid or
 * over-long tags rather than hand-rolling a BCP 47 parser.
 */
export function canonicalizeNarrationLocale(code: unknown): string {
  if (typeof code !== 'string' || code.trim() === '') {
    throw new NarrationLocaleConfigError(
      'locale code must be a non-empty string',
    );
  }
  let canonical: string | undefined;
  try {
    [canonical] = Intl.getCanonicalLocales(code.trim());
  } catch {
    throw new NarrationLocaleConfigError(`"${code}" is not a valid BCP 47 tag`);
  }
  if (!canonical) {
    throw new NarrationLocaleConfigError(`"${code}" is not a valid BCP 47 tag`);
  }
  if (canonical.length > MAX_NARRATION_LOCALE_CODE_LENGTH) {
    throw new NarrationLocaleConfigError(
      `"${canonical}" exceeds ${MAX_NARRATION_LOCALE_CODE_LENGTH} characters`,
    );
  }
  return canonical;
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new NarrationLocaleConfigError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function requireString(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new NarrationLocaleConfigError(`${label} must be a non-empty string`);
  }
  return value;
}

function parseEntry(raw: unknown, index: number): NarrationLocaleConfigEntry {
  const record = asRecord(raw, `locales[${index}]`);
  const code = canonicalizeNarrationLocale(record.code);
  const nativeLabel = requireString(
    record.nativeLabel,
    `locales[${index}].nativeLabel`,
  );
  const speechTag = requireString(
    record.speechTag,
    `locales[${index}].speechTag`,
  );

  let enabled = true;
  if (record.enabled !== undefined) {
    if (typeof record.enabled !== 'boolean') {
      throw new NarrationLocaleConfigError(
        `locales[${index}].enabled must be a boolean`,
      );
    }
    enabled = record.enabled;
  }

  let fallbackLocale: string | null = null;
  if (record.fallbackLocale !== undefined && record.fallbackLocale !== null) {
    fallbackLocale = canonicalizeNarrationLocale(record.fallbackLocale);
  }

  return { code, nativeLabel, speechTag, enabled, fallbackLocale };
}

/**
 * Validate an already-parsed config object and return a canonicalised config.
 * Throws {@link NarrationLocaleConfigError} on any violation so the API fails
 * fast at startup instead of serving an invalid catalog.
 */
export function parseNarrationLocaleConfig(
  raw: unknown,
): NarrationLocaleConfig {
  const record = asRecord(raw, 'config');

  if (!Array.isArray(record.locales) || record.locales.length === 0) {
    throw new NarrationLocaleConfigError('locales must be a non-empty array');
  }

  const locales = record.locales.map((entry, index) =>
    parseEntry(entry, index),
  );

  const byCode = new Map<string, NarrationLocaleConfigEntry>();
  for (const entry of locales) {
    if (byCode.has(entry.code)) {
      throw new NarrationLocaleConfigError(
        `duplicate locale code "${entry.code}"`,
      );
    }
    byCode.set(entry.code, entry);
  }

  const defaultLocale = canonicalizeNarrationLocale(record.defaultLocale);
  const defaultEntry = byCode.get(defaultLocale);
  if (!defaultEntry) {
    throw new NarrationLocaleConfigError(
      `defaultLocale "${defaultLocale}" is not listed`,
    );
  }
  if (!defaultEntry.enabled) {
    throw new NarrationLocaleConfigError(
      `defaultLocale "${defaultLocale}" must be enabled`,
    );
  }

  for (const entry of locales) {
    if (entry.fallbackLocale === null) continue;
    if (entry.fallbackLocale === entry.code) {
      throw new NarrationLocaleConfigError(
        `locale "${entry.code}" cannot fall back to itself`,
      );
    }
    const target = byCode.get(entry.fallbackLocale);
    if (!target) {
      throw new NarrationLocaleConfigError(
        `locale "${entry.code}" falls back to unknown locale "${entry.fallbackLocale}"`,
      );
    }
    if (!target.enabled) {
      throw new NarrationLocaleConfigError(
        `locale "${entry.code}" falls back to disabled locale "${entry.fallbackLocale}"`,
      );
    }
  }

  // Detect fallback cycles by walking each chain.
  for (const start of locales) {
    const seen = new Set<string>([start.code]);
    let cursor: string | null = start.fallbackLocale;
    while (cursor !== null) {
      if (seen.has(cursor)) {
        throw new NarrationLocaleConfigError(
          `fallback cycle detected starting at "${start.code}"`,
        );
      }
      seen.add(cursor);
      cursor = byCode.get(cursor)?.fallbackLocale ?? null;
    }
  }

  for (const required of REQUIRED_NARRATION_LOCALES) {
    const entry = byCode.get(required);
    if (!entry || !entry.enabled) {
      throw new NarrationLocaleConfigError(
        `locale "${required}" must be present and enabled for backward compatibility`,
      );
    }
  }

  return { defaultLocale, locales };
}

export interface LoadNarrationLocaleConfigOptions {
  /** Environment map (defaults to `process.env`). */
  env?: NodeJS.ProcessEnv;
  /** Working directory the default path resolves against (defaults to `process.cwd()`). */
  cwd?: string;
  /** Explicit path; overrides both the env var and the default path. */
  configPath?: string;
  /** File reader seam for tests. */
  readFile?: (path: string) => string;
}

/**
 * Load and validate the narration-locale config from disk.
 *
 * Resolution order for the path: explicit `configPath` →
 * `NARRATION_LOCALES_CONFIG_PATH` → `<cwd>/config/narration-locales.json`.
 * If no path is explicitly configured and the default file is absent, the
 * built-in {@link DEFAULT_NARRATION_LOCALE_CONFIG} is used so `vi`/`en` keep
 * working. A path that IS configured but unreadable, or any invalid content,
 * throws so the API fails fast at startup.
 */
export function loadNarrationLocaleConfig(
  options: LoadNarrationLocaleConfigOptions = {},
): NarrationLocaleConfig {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const reader =
    options.readFile ?? ((path: string) => readFileSync(path, 'utf8'));

  const explicitPath =
    options.configPath ?? env[NARRATION_LOCALES_CONFIG_PATH_ENV]?.trim();
  const path = resolve(
    cwd,
    explicitPath && explicitPath.length > 0
      ? explicitPath
      : DEFAULT_NARRATION_LOCALES_CONFIG_PATH,
  );

  let contents: string;
  try {
    contents = reader(path);
  } catch (error) {
    const missing =
      typeof error === 'object' &&
      error !== null &&
      (error as NodeJS.ErrnoException).code === 'ENOENT';
    if (missing && !explicitPath) {
      return DEFAULT_NARRATION_LOCALE_CONFIG;
    }
    throw new NarrationLocaleConfigError(
      `cannot read config file at "${path}"`,
    );
  }

  let raw: unknown;
  try {
    raw = JSON.parse(contents);
  } catch {
    throw new NarrationLocaleConfigError(`"${path}" is not valid JSON`);
  }

  return parseNarrationLocaleConfig(raw);
}

/** Enabled locales in display order. */
export function listEnabledNarrationLocales(
  config: NarrationLocaleConfig,
): NarrationLocaleConfigEntry[] {
  return config.locales.filter((locale) => locale.enabled);
}

/** Whether the given code is a known, enabled locale. Canonicalises leniently. */
export function isNarrationLocaleEnabled(
  config: NarrationLocaleConfig,
  code: string,
): boolean {
  let canonical: string;
  try {
    canonical = canonicalizeNarrationLocale(code);
  } catch {
    return false;
  }
  return config.locales.some(
    (locale) => locale.code === canonical && locale.enabled,
  );
}

/**
 * Ordered list of locale codes to try for a requested locale: the requested
 * code first, then its fallback lineage. Unknown or disabled codes yield an
 * empty chain. Validation guarantees the lineage is finite and enabled.
 */
export function narrationLocaleFallbackChain(
  config: NarrationLocaleConfig,
  requestedCode: string,
): string[] {
  let canonical: string;
  try {
    canonical = canonicalizeNarrationLocale(requestedCode);
  } catch {
    return [];
  }
  const byCode = new Map(config.locales.map((locale) => [locale.code, locale]));
  const start = byCode.get(canonical);
  if (!start || !start.enabled) return [];

  const chain: string[] = [];
  const seen = new Set<string>();
  let cursor: string | null = canonical;
  while (cursor !== null && !seen.has(cursor)) {
    const entry = byCode.get(cursor);
    if (!entry || !entry.enabled) break;
    chain.push(cursor);
    seen.add(cursor);
    cursor = entry.fallbackLocale;
  }
  return chain;
}
