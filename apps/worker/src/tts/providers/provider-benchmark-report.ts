import type {
  BenchmarkThresholds,
  ProviderBenchmarkEntry,
  ProviderComparisonReport,
} from './provider-benchmark.js';

/**
 * Report validator for the AI05 provider comparison (the "report validator"
 * acceptance item). Enforces the integrity rules a decision must rest on:
 * thresholds fixed up front, every provider scored on the identical normalized
 * input set, hardware + license disclosed, failures disclosed, pinned model
 * versions, and no transcript text anywhere in the report.
 *
 * Pure and deterministic: returns the list of violations (empty = valid).
 */

export class ProviderBenchmarkReportError extends Error {
  constructor(public readonly violations: readonly string[]) {
    super(`invalid provider benchmark report:\n- ${violations.join('\n- ')}`);
    this.name = 'ProviderBenchmarkReportError';
  }
}

function checkThresholds(t: BenchmarkThresholds, out: string[]): void {
  const positive = (v: number, name: string): void => {
    if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0) {
      out.push(`thresholds.${name} must be a positive number`);
    }
  };
  positive(t.maxP95GenerationMs, 'maxP95GenerationMs');
  positive(t.maxMeanRealTimeFactor, 'maxMeanRealTimeFactor');
  positive(t.minLocales, 'minLocales');
  if (
    typeof t.maxFailureRate !== 'number' ||
    t.maxFailureRate < 0 ||
    t.maxFailureRate > 1
  ) {
    out.push('thresholds.maxFailureRate must be between 0 and 1');
  }
}

function checkProvider(
  entry: ProviderBenchmarkEntry,
  inputIdsByLocale: Map<string, Set<string>>,
  out: string[],
): void {
  const where = `provider "${entry.provider}@${entry.modelVersion}"`;
  if (entry.modelVersion === 'main' || entry.modelVersion === 'latest') {
    out.push(`${where} must pin an immutable modelVersion`);
  }
  if (entry.hardwareClass !== 'cpu' && entry.hardwareClass !== 'gpu') {
    out.push(`${where} has an invalid hardwareClass`);
  }
  if (!entry.license) out.push(`${where} is missing its license`);
  if (!entry.sourceUrl) out.push(`${where} is missing its sourceUrl`);
  if (!Array.isArray(entry.violations)) {
    out.push(`${where} must disclose a violations array`);
  }
  // Same normalized inputs: the provider's sample ids must equal the input set
  // for its locale (runTtsBenchmark only runs the provider's locale).
  const expected = inputIdsByLocale.get(entry.locale);
  if (entry.count > 0 && expected) {
    const got = new Set(entry.report.samples.map((s) => s.id));
    for (const id of expected) {
      if (!got.has(id)) out.push(`${where} is missing input "${id}"`);
    }
    for (const id of got) {
      if (!expected.has(id)) out.push(`${where} ran unexpected input "${id}"`);
    }
  }
  // Privacy: no transcript text may appear in any sample.
  for (const sample of entry.report.samples) {
    const keys = Object.keys(sample);
    if (keys.includes('text') || keys.includes('transcript')) {
      out.push(`${where} leaks transcript text in sample "${sample.id}"`);
    }
  }
}

export function validateProviderComparisonReport(
  report: ProviderComparisonReport,
): string[] {
  const out: string[] = [];
  if (report.schema !== 'tts-provider-benchmark/v1') {
    out.push(`unexpected schema "${report.schema}"`);
  }
  checkThresholds(report.thresholds, out);

  if (!Array.isArray(report.inputSet) || report.inputSet.length === 0) {
    out.push('inputSet must be a non-empty array');
  }
  const locales = new Set(report.inputSet.map((s) => s.locale));
  if (locales.size < report.thresholds.minLocales) {
    out.push(
      `inputSet covers ${locales.size} locale(s) < minLocales ${report.thresholds.minLocales}`,
    );
  }
  for (const s of report.inputSet) {
    if (!/^[0-9a-f]{64}$/.test(s.inputSha256)) {
      out.push(`inputSet entry "${s.id}" has an invalid inputSha256`);
    }
  }

  const inputIdsByLocale = new Map<string, Set<string>>();
  for (const s of report.inputSet) {
    const set = inputIdsByLocale.get(s.locale) ?? new Set<string>();
    set.add(s.id);
    inputIdsByLocale.set(s.locale, set);
  }

  if (!Array.isArray(report.providers) || report.providers.length === 0) {
    out.push('providers must be a non-empty array');
  } else {
    for (const entry of report.providers) {
      checkProvider(entry, inputIdsByLocale, out);
    }
    if (!report.providers.some((p) => p.count > 0)) {
      out.push('no provider produced any measurement');
    }
  }

  if (!Array.isArray(report.recommendationsByLocale)) {
    out.push('recommendationsByLocale must be an array');
  }
  return out;
}

export function assertValidProviderComparisonReport(
  report: ProviderComparisonReport,
): void {
  const violations = validateProviderComparisonReport(report);
  if (violations.length > 0) throw new ProviderBenchmarkReportError(violations);
}
