import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { TtsModelRegistry } from '../tts-model-registry.js';
import type { TtsModelRegistryEntry } from '../types.js';
import {
  CliTtsProvider,
  type CliProviderSpec,
  type CliRunner,
  type HardwareClass,
} from './cli-tts-provider.js';
import type { ProviderCandidate } from './provider-benchmark.js';

/**
 * Candidate-provider manifest for the AI05 benchmark
 * (`config/tts-benchmark-providers.json`). Lists each engine to compare under
 * the shared `TtsProvider` contract with its pinned version, license, source and
 * CLI spec. `config/tts-benchmark-providers.example.json` is the committed
 * template; the real file is filled from each engine's model card (pinned
 * version + license + checksum) before running the benchmark.
 */

export interface BenchmarkProviderEntry
  extends TtsModelRegistryEntry,
    Omit<CliProviderSpec, keyof TtsModelRegistryEntry> {
  hardwareClass: HardwareClass;
}

export interface BenchmarkProvidersManifest {
  entries: BenchmarkProviderEntry[];
}

export class BenchmarkProvidersManifestError extends Error {
  constructor(message: string) {
    super(`benchmark providers manifest: ${message}`);
    this.name = 'BenchmarkProvidersManifestError';
  }
}

export const BENCHMARK_PROVIDERS_CONFIG_PATH_ENV =
  'TTS_BENCHMARK_PROVIDERS_CONFIG_PATH';
export const DEFAULT_BENCHMARK_PROVIDERS_CONFIG_PATH =
  'config/tts-benchmark-providers.json';

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new BenchmarkProvidersManifestError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function str(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new BenchmarkProvidersManifestError(
      `${label} must be a non-empty string`,
    );
  }
  return value;
}

function parseEntry(raw: unknown, index: number): BenchmarkProviderEntry {
  const e = record(raw, `entries[${index}]`);
  const hardwareClass = str(e.hardwareClass, `entries[${index}].hardwareClass`);
  if (hardwareClass !== 'cpu' && hardwareClass !== 'gpu') {
    throw new BenchmarkProvidersManifestError(
      `entries[${index}].hardwareClass must be "cpu" or "gpu"`,
    );
  }
  if (!Array.isArray(e.argsTemplate) || e.argsTemplate.length === 0) {
    throw new BenchmarkProvidersManifestError(
      `entries[${index}].argsTemplate must be a non-empty array`,
    );
  }
  const argsTemplate = e.argsTemplate.map((arg, i) =>
    str(arg, `entries[${index}].argsTemplate[${i}]`),
  );
  const textViaStdin = e.textViaStdin === true;
  const joined = argsTemplate.join(' ');
  if (!joined.includes('{out}')) {
    throw new BenchmarkProvidersManifestError(
      `entries[${index}].argsTemplate must reference {out} for the WAV output path`,
    );
  }
  if (!textViaStdin && !joined.includes('{text}')) {
    throw new BenchmarkProvidersManifestError(
      `entries[${index}] must pass the transcript: set textViaStdin or reference {text}`,
    );
  }

  const entry: BenchmarkProviderEntry = {
    provider: str(e.provider, `entries[${index}].provider`),
    model: str(e.model, `entries[${index}].model`),
    modelVersion: str(e.modelVersion, `entries[${index}].modelVersion`),
    voiceId: str(e.voiceId, `entries[${index}].voiceId`),
    locale: str(e.locale, `entries[${index}].locale`),
    license: str(e.license, `entries[${index}].license`),
    sourceUrl: str(e.sourceUrl, `entries[${index}].sourceUrl`),
    checksum: str(e.checksum, `entries[${index}].checksum`),
    enabled: e.enabled !== false,
    hardwareClass,
    command: str(e.command, `entries[${index}].command`),
    argsTemplate,
    textViaStdin,
  };
  if (e.modelPath !== undefined)
    entry.modelPath = str(e.modelPath, `entries[${index}].modelPath`);
  if (e.speaker !== undefined) {
    if (typeof e.speaker !== 'number' || !Number.isInteger(e.speaker)) {
      throw new BenchmarkProvidersManifestError(
        `entries[${index}].speaker must be an integer`,
      );
    }
    entry.speaker = e.speaker;
  }
  if (e.timeoutMs !== undefined) {
    if (typeof e.timeoutMs !== 'number' || e.timeoutMs <= 0) {
      throw new BenchmarkProvidersManifestError(
        `entries[${index}].timeoutMs must be a positive number`,
      );
    }
    entry.timeoutMs = e.timeoutMs;
  }
  return entry;
}

export function parseBenchmarkProvidersManifest(
  raw: unknown,
): BenchmarkProvidersManifest {
  const root = record(raw, 'manifest');
  if (!Array.isArray(root.entries) || root.entries.length === 0) {
    throw new BenchmarkProvidersManifestError(
      'entries must be a non-empty array',
    );
  }
  const entries = root.entries.map((e, i) => parseEntry(e, i));
  // Reuse registry validation: license/source/checksum/immutable version/dups.
  new TtsModelRegistry(entries);
  return { entries };
}

export function loadBenchmarkProvidersManifest(
  options: {
    env?: NodeJS.ProcessEnv;
    cwd?: string;
    configPath?: string;
    readFile?: (path: string) => string;
  } = {},
): BenchmarkProvidersManifest {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const reader =
    options.readFile ?? ((path: string) => readFileSync(path, 'utf8'));
  const configured =
    options.configPath ??
    env[BENCHMARK_PROVIDERS_CONFIG_PATH_ENV]?.trim() ??
    DEFAULT_BENCHMARK_PROVIDERS_CONFIG_PATH;
  const path = resolve(cwd, configured);

  let contents: string;
  try {
    contents = reader(path);
  } catch {
    throw new BenchmarkProvidersManifestError(
      `cannot read manifest at "${path}" (copy config/tts-benchmark-providers.example.json and fill it)`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch {
    throw new BenchmarkProvidersManifestError(`"${path}" is not valid JSON`);
  }
  return parseBenchmarkProvidersManifest(parsed);
}

/** The CLI spec for one manifest entry. */
export function toCliProviderSpec(
  entry: BenchmarkProviderEntry,
): CliProviderSpec {
  const spec: CliProviderSpec = {
    provider: entry.provider,
    model: entry.model,
    modelVersion: entry.modelVersion,
    voiceId: entry.voiceId,
    locale: entry.locale,
    hardwareClass: entry.hardwareClass,
    command: entry.command,
    argsTemplate: entry.argsTemplate,
    textViaStdin: entry.textViaStdin,
  };
  if (entry.modelPath !== undefined) spec.modelPath = entry.modelPath;
  if (entry.speaker !== undefined) spec.speaker = entry.speaker;
  if (entry.timeoutMs !== undefined) spec.timeoutMs = entry.timeoutMs;
  return spec;
}

/**
 * Build benchmark candidates for enabled manifest entries, carrying the
 * hardware/license metadata the base `TtsProvider` contract does not. GPU-class
 * candidates are excluded unless `includeGpu` is set, keeping the CPU benchmark
 * the default critical path (MOSS-TTS stays off it per the roadmap).
 */
export function buildBenchmarkProviders(
  manifest: BenchmarkProvidersManifest,
  options: { includeGpu?: boolean; runner?: CliRunner } = {},
): ProviderCandidate[] {
  return manifest.entries
    .filter((entry) => entry.enabled)
    .filter((entry) => options.includeGpu || entry.hardwareClass === 'cpu')
    .map((entry) => ({
      provider: new CliTtsProvider(toCliProviderSpec(entry), options.runner),
      hardwareClass: entry.hardwareClass,
      license: entry.license,
      sourceUrl: entry.sourceUrl,
      voiceId: entry.voiceId,
    }));
}
