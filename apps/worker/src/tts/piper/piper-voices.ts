import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { TtsModelRegistry } from '../tts-model-registry.js';
import type { TtsModelRegistryEntry } from '../types.js';
import { PiperTtsProvider, type PiperRunner } from './piper-tts-provider.js';

/**
 * Pinned Piper voice manifest (`config/tts-voices.json`). Carries the registry
 * fields plus the local model path. The real file (with checksums) is written by
 * `scripts/setup-piper-voices.mjs`; `config/tts-voices.example.json` is the
 * committed template.
 */

export interface PiperVoiceManifestEntry extends TtsModelRegistryEntry {
  /** Local path to the `.onnx` voice file (relative to cwd or absolute). */
  modelPath: string;
  speaker?: number;
  lengthScale?: number;
}

export interface PiperVoiceManifest {
  /** Path to the piper executable (or `piper` on PATH). */
  binaryPath: string;
  voices: PiperVoiceManifestEntry[];
}

export class PiperVoiceManifestError extends Error {
  constructor(message: string) {
    super(`piper voice manifest: ${message}`);
    this.name = 'PiperVoiceManifestError';
  }
}

export const PIPER_VOICES_CONFIG_PATH_ENV = 'PIPER_VOICES_CONFIG_PATH';
export const DEFAULT_PIPER_VOICES_CONFIG_PATH = 'config/tts-voices.json';

function record(value: unknown, label: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new PiperVoiceManifestError(`${label} must be an object`);
  }
  return value as Record<string, unknown>;
}

function str(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new PiperVoiceManifestError(`${label} must be a non-empty string`);
  }
  return value;
}

export function parsePiperVoiceManifest(raw: unknown): PiperVoiceManifest {
  const root = record(raw, 'manifest');
  const binaryPath = str(root.binaryPath, 'binaryPath');
  if (!Array.isArray(root.voices) || root.voices.length === 0) {
    throw new PiperVoiceManifestError('voices must be a non-empty array');
  }

  const voices = root.voices.map((raw, index): PiperVoiceManifestEntry => {
    const entry = record(raw, `voices[${index}]`);
    if (entry.provider !== 'piper') {
      throw new PiperVoiceManifestError(
        `voices[${index}].provider must be "piper"`,
      );
    }
    const voice: PiperVoiceManifestEntry = {
      provider: 'piper',
      model: str(entry.model, `voices[${index}].model`),
      modelVersion: str(entry.modelVersion, `voices[${index}].modelVersion`),
      voiceId: str(entry.voiceId, `voices[${index}].voiceId`),
      locale: str(entry.locale, `voices[${index}].locale`),
      license: str(entry.license, `voices[${index}].license`),
      sourceUrl: str(entry.sourceUrl, `voices[${index}].sourceUrl`),
      checksum: str(entry.checksum, `voices[${index}].checksum`),
      modelPath: str(entry.modelPath, `voices[${index}].modelPath`),
      enabled: entry.enabled !== false,
    };
    if (entry.speaker !== undefined) {
      if (
        typeof entry.speaker !== 'number' ||
        !Number.isInteger(entry.speaker)
      ) {
        throw new PiperVoiceManifestError(
          `voices[${index}].speaker must be an integer`,
        );
      }
      voice.speaker = entry.speaker;
    }
    if (entry.lengthScale !== undefined) {
      if (typeof entry.lengthScale !== 'number' || entry.lengthScale <= 0) {
        throw new PiperVoiceManifestError(
          `voices[${index}].lengthScale must be a positive number`,
        );
      }
      voice.lengthScale = entry.lengthScale;
    }
    return voice;
  });

  // Reuse the shared registry validation (checksum/immutable version/duplicates).
  new TtsModelRegistry(voices);

  return { binaryPath, voices };
}

export function loadPiperVoiceManifest(
  options: {
    env?: NodeJS.ProcessEnv;
    cwd?: string;
    configPath?: string;
    readFile?: (path: string) => string;
  } = {},
): PiperVoiceManifest {
  const env = options.env ?? process.env;
  const cwd = options.cwd ?? process.cwd();
  const reader =
    options.readFile ?? ((path: string) => readFileSync(path, 'utf8'));
  const configured =
    options.configPath ??
    env[PIPER_VOICES_CONFIG_PATH_ENV]?.trim() ??
    DEFAULT_PIPER_VOICES_CONFIG_PATH;
  const path = resolve(cwd, configured);

  let contents: string;
  try {
    contents = reader(path);
  } catch {
    throw new PiperVoiceManifestError(
      `cannot read manifest at "${path}" (run scripts/setup-piper-voices.mjs first)`,
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(contents);
  } catch {
    throw new PiperVoiceManifestError(`"${path}" is not valid JSON`);
  }
  const manifest = parsePiperVoiceManifest(parsed);
  // Machine-specific Piper location (e.g. a venv's piper.exe on Windows)
  // without editing the committed manifest.
  const binaryOverride = env[PIPER_BINARY_ENV]?.trim();
  return binaryOverride
    ? { ...manifest, binaryPath: binaryOverride }
    : manifest;
}

/** Overrides the manifest `binaryPath` (absolute path to piper / piper.exe). */
export const PIPER_BINARY_ENV = 'TTS_PIPER_BINARY';

/** Registry built from the manifest voices (for enabled/license/locale lookup). */
export function toTtsModelRegistry(
  manifest: PiperVoiceManifest,
): TtsModelRegistry {
  return new TtsModelRegistry(manifest.voices);
}

/** Build a Piper provider bound to one voice. */
export function buildPiperProvider(
  manifest: PiperVoiceManifest,
  entry: PiperVoiceManifestEntry,
  runner?: PiperRunner,
): PiperTtsProvider {
  return new PiperTtsProvider(
    {
      model: entry.model,
      modelVersion: entry.modelVersion,
      voiceId: entry.voiceId,
      locale: entry.locale,
      binaryPath: manifest.binaryPath,
      modelPath: entry.modelPath,
      speaker: entry.speaker,
      lengthScale: entry.lengthScale,
    },
    runner,
  );
}
