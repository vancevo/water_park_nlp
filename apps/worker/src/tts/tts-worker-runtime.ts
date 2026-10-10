import { createRequire } from 'node:module';

import { loadAiFeatureFlags } from '../ops/ai-feature-flags.js';
import { MetricsRegistry } from '../ops/metrics.js';
import {
  loadMetricsServerConfig,
  startMetricsServer,
  type RunningMetricsServer,
} from '../ops/metrics-server.js';
import { loadQuotaConfig, QuotaGuard } from '../ops/quota.js';
import { TtsMetrics } from '../ops/tts-metrics.js';
import { createAudioEncoder, loadAudioEncoderConfig } from './audio-encoder.js';
import {
  buildPiperProvider,
  loadPiperVoiceManifest,
} from './piper/piper-voices.js';
import {
  loadBenchmarkProvidersManifest,
  toCliProviderSpec,
} from './providers/benchmark-providers-manifest.js';
import { CliTtsProvider } from './providers/cli-tts-provider.js';
import {
  PostgresTtsJobQueue,
  type SqlTransactionalPool,
} from './postgres-tts-job-queue.js';
import {
  S3TtsAudioStore,
  type S3TtsAudioStoreConfig,
} from './tts-audio-store.js';
import {
  TtsJobConsumer,
  TtsJobRunner,
  type TtsVoiceBinding,
} from './tts-job-runner.js';

/**
 * Composition root of the TTS queue consumer (I02). Configuration comes from
 * env only; nothing here is engine- or vendor-specific beyond choosing the
 * manifest format.
 */

export type TtsWorkerEngine = 'piper' | 'cli';

export interface TtsWorkerConfig {
  databaseUrl: string;
  engine: TtsWorkerEngine;
  /** Piper voice manifest or CLI provider manifest (same file the API reads). */
  voicesManifestPath: string;
  storage: S3TtsAudioStoreConfig;
  pollIntervalMs: number;
  timeoutMs: number;
  baseBackoffMs: number;
  staleRunningMs: number;
  rightsOwner: string;
}

export class TtsWorkerConfigError extends Error {
  constructor(message: string) {
    super(`tts worker config: ${message}`);
    this.name = 'TtsWorkerConfigError';
  }
}

function positiveInt(
  env: NodeJS.ProcessEnv,
  name: string,
  fallback: number,
): number {
  const raw = env[name];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n <= 0)
    throw new TtsWorkerConfigError(`${name} must be a positive integer`);
  return n;
}

/** Upload + verify + attach: three S3 calls, each capped at 60 s by the audio store. */
const STORAGE_WORST_CASE_MS = 3 * 60_000;

/**
 * Longest a healthy claim can go without a heartbeat (the row is touched at the
 * start of every attempt): one synthesis timeout, the storage calls, and the
 * longest backoff before the next attempt. A stale window at or below this
 * would let another worker re-claim a job that is still running.
 */
export function minimumStaleRunningMs(input: {
  timeoutMs: number;
  baseBackoffMs: number;
  maxAttempts: number;
}): number {
  const longestBackoff =
    input.baseBackoffMs * 2 ** Math.max(0, input.maxAttempts - 2);
  return input.timeoutMs + STORAGE_WORST_CASE_MS + longestBackoff;
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new TtsWorkerConfigError(`${name} is required`);
  return value;
}

export function loadTtsWorkerConfig(
  env: NodeJS.ProcessEnv = process.env,
): TtsWorkerConfig {
  const engine = (env.TTS_WORKER_ENGINE?.trim() || 'piper') as TtsWorkerEngine;
  if (engine !== 'piper' && engine !== 'cli')
    throw new TtsWorkerConfigError(
      'TTS_WORKER_ENGINE must be "piper" or "cli"',
    );
  if (env.S3_ENABLED === 'false')
    throw new TtsWorkerConfigError(
      'object storage is required to store generated audio (S3_ENABLED=false)',
    );
  const timeoutMs = positiveInt(env, 'TTS_JOB_TIMEOUT_MS', 120_000);
  const staleRunningMs = positiveInt(
    env,
    'TTS_JOB_STALE_RUNNING_MS',
    30 * 60_000,
  );
  const baseBackoffMs = positiveInt(env, 'TTS_JOB_BACKOFF_MS', 500);
  const maxAttempts = positiveInt(env, 'TTS_JOB_MAX_ATTEMPTS', 3);
  const minStaleMs = minimumStaleRunningMs({
    timeoutMs,
    baseBackoffMs,
    maxAttempts,
  });
  if (staleRunningMs <= minStaleMs)
    throw new TtsWorkerConfigError(
      `TTS_JOB_STALE_RUNNING_MS (${staleRunningMs}) must exceed one attempt's worst case ` +
        `(${minStaleMs} ms = TTS_JOB_TIMEOUT_MS + storage calls + longest backoff); ` +
        'otherwise a live job is re-claimed mid-run',
    );
  return {
    databaseUrl: required(env, 'DATABASE_URL'),
    engine,
    voicesManifestPath:
      env.TTS_VOICES_MANIFEST_PATH?.trim() || 'config/tts-voices.json',
    storage: {
      endpoint: required(env, 'S3_ENDPOINT'),
      region: env.S3_REGION?.trim() || 'us-east-1',
      bucket: required(env, 'S3_BUCKET'),
      accessKey: required(env, 'S3_ACCESS_KEY'),
      secretKey: required(env, 'S3_SECRET_KEY'),
    },
    pollIntervalMs: positiveInt(env, 'TTS_WORKER_POLL_MS', 1000),
    timeoutMs,
    baseBackoffMs,
    staleRunningMs,
    rightsOwner:
      env.TTS_AUDIO_RIGHTS_OWNER?.trim() ||
      'Dam Sen Smart Guide project (AI-generated draft)',
  };
}

/** One binding per locale: the first enabled manifest voice (registry order). */
export function loadVoiceBindings(
  config: Pick<TtsWorkerConfig, 'engine' | 'voicesManifestPath'>,
  options: { readFile?: (path: string) => string; cwd?: string } = {},
): Map<string, TtsVoiceBinding> {
  const bindings = new Map<string, TtsVoiceBinding>();
  if (config.engine === 'piper') {
    const manifest = loadPiperVoiceManifest({
      configPath: config.voicesManifestPath,
      ...options,
    });
    for (const entry of manifest.voices) {
      if (!entry.enabled || bindings.has(entry.locale)) continue;
      bindings.set(entry.locale, {
        entry,
        provider: buildPiperProvider(manifest, entry),
      });
    }
  } else {
    const manifest = loadBenchmarkProvidersManifest({
      configPath: config.voicesManifestPath,
      ...options,
    });
    for (const entry of manifest.entries) {
      if (!entry.enabled || bindings.has(entry.locale)) continue;
      bindings.set(entry.locale, {
        entry,
        provider: new CliTtsProvider(toCliProviderSpec(entry)),
      });
    }
  }
  if (bindings.size === 0)
    throw new TtsWorkerConfigError('the voice manifest has no enabled voice');
  return bindings;
}

export interface RunningTtsWorker {
  consumer: TtsJobConsumer;
  metrics: MetricsRegistry;
  stop(): Promise<void>;
}

export function startTtsWorker(
  env: NodeJS.ProcessEnv = process.env,
  log: (line: string) => void = (line) => console.log(line),
): RunningTtsWorker {
  const config = loadTtsWorkerConfig(env);
  const metricsServerConfig = loadMetricsServerConfig(env);
  const encoderConfig = loadAudioEncoderConfig(env);
  const bindings = loadVoiceBindings(config);
  const require = createRequire(import.meta.url);
  const pg = require('pg') as {
    Pool: new (options: {
      connectionString: string;
      max?: number;
    }) => SqlTransactionalPool & {
      end(): Promise<void>;
      on(
        event: 'error',
        listener: (error: Error & { code?: string }) => void,
      ): void;
    };
  };
  const pool = new pg.Pool({ connectionString: config.databaseUrl, max: 8 });
  // An idle client closed by the server (DB restart/failover) is emitted on
  // the pool; unhandled, it kills the worker (I04 drill). The pool drops the
  // client and the next query reconnects.
  pool.on('error', (error) =>
    log(
      `tts worker: postgres idle client error ${error.code ?? error.name}; client discarded`,
    ),
  );
  const registry = new MetricsRegistry();
  const metrics = new TtsMetrics(registry);
  const queue = new PostgresTtsJobQueue(pool, {
    staleRunningMs: config.staleRunningMs,
  });
  const store = new S3TtsAudioStore(config.storage);
  const runner = new TtsJobRunner(
    queue,
    store,
    (locale) => bindings.get(locale) ?? null,
    {
      timeoutMs: config.timeoutMs,
      baseBackoffMs: config.baseBackoffMs,
      rightsOwner: config.rightsOwner,
    },
    { metrics, log, encoder: createAudioEncoder(encoderConfig) },
  );
  const consumer = new TtsJobConsumer(queue, runner, {
    flags: () => loadAiFeatureFlags(env),
    quota: new QuotaGuard(loadQuotaConfig(env)),
    pollIntervalMs: config.pollIntervalMs,
    metrics,
    log,
  });
  const voices = [...bindings.values()]
    .map(
      ({ entry }) =>
        `${entry.locale}=${entry.provider}/${entry.model}@${entry.modelVersion}`,
    )
    .join(', ');
  log(
    `tts worker: engine=${config.engine} release=${encoderConfig.format} voices: ${voices}`,
  );
  consumer.start();
  // Prometheus scrape endpoint (C07). A bind failure is logged, not fatal:
  // losing observability must never stop audio generation.
  let metricsServer: Promise<RunningMetricsServer | null> =
    Promise.resolve(null);
  if (metricsServerConfig.enabled) {
    metricsServer = startMetricsServer(registry, metricsServerConfig).then(
      (running) => {
        log(
          `tts worker: metrics on http://${metricsServerConfig.host}:${running.port}/metrics`,
        );
        return running;
      },
      (error: Error & { code?: string }) => {
        log(
          `tts worker: metrics endpoint disabled (${error.code ?? error.name})`,
        );
        return null;
      },
    );
  }
  return {
    consumer,
    metrics: registry,
    async stop() {
      await consumer.stop();
      await (await metricsServer)?.close();
      store.destroy();
      await pool.end();
    },
  };
}
