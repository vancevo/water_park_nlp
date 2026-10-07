import { ApiClientError, DamSenApiClient } from '@damsen/api-client';
import type {
  CreateTtsJobRequest,
  TtsGenerationJob,
  TtsJobStatus,
} from '@damsen/shared-types';
import { apiBase } from './api-poi-client';
import { requireAccessToken } from './auth-session';
import { createDemoToneWav } from './demo-wav';

/**
 * App-local port for admin TTS jobs (contract v1):
 * POST /v1/admin/narrations/:narrationId/tts-jobs, GET /v1/admin/tts-jobs/:jobId,
 * POST /v1/admin/tts-jobs/:jobId/cancel. Retry is a new create call; the
 * backend idempotency key decides whether a failed job is re-run.
 */
export interface TtsGenerationPort {
  readonly mode: 'demo' | 'api';
  create(
    narrationId: string,
    input: CreateTtsJobRequest,
  ): Promise<TtsGenerationJob>;
  get(jobId: string): Promise<TtsGenerationJob>;
  cancel(jobId: string): Promise<TtsGenerationJob>;
  /**
   * Optional local preview of a succeeded job. Contract v1 has no audio URL on
   * the job; the API adapter therefore omits it and the reviewer listens to the
   * draft narration after it reloads (see contract gap in the runbook).
   */
  previewAudio?(job: TtsGenerationJob): Promise<Blob | null>;
}

export const TERMINAL_TTS_STATUSES: readonly TtsJobStatus[] = [
  'succeeded',
  'failed',
  'cancelled',
];
export const isTerminalTtsStatus = (status: TtsJobStatus) =>
  TERMINAL_TTS_STATUSES.includes(status);

export type FixtureOutcome =
  | { status: 'succeeded' }
  | { status: 'failed'; errorCode: string };

export interface FixtureTtsOptions {
  now?: () => number;
  queuedMs?: number;
  runningMs?: number;
  /** Decides the terminal state of an attempt (1-based per narration+locale). */
  outcome?: (input: {
    narrationId: string;
    locale: string;
    attempt: number;
  }) => FixtureOutcome;
  newId?: () => string;
}

/** Demo script: French fails once with a timeout so retry is visible; everything else succeeds. */
export const defaultFixtureOutcome: NonNullable<
  FixtureTtsOptions['outcome']
> = ({ locale, attempt }) =>
  locale === 'fr' && attempt === 1
    ? { status: 'failed', errorCode: 'TTS_TIMEOUT' }
    : { status: 'succeeded' };

interface FixtureRecord {
  job: TtsGenerationJob;
  locale: string;
  createdAtMs: number;
  outcome: FixtureOutcome;
  cancelled: boolean;
}

/**
 * In-memory simulation of the contract v1 job lifecycle:
 * queued → running → succeeded | failed, with cancel from queued/running.
 * Status advances from elapsed time when the job is read, like polling a worker.
 */
export function createFixtureTtsGenerationPort(
  options: FixtureTtsOptions = {},
): TtsGenerationPort {
  const now = options.now ?? (() => Date.now());
  const queuedMs = options.queuedMs ?? 1_200;
  const runningMs = options.runningMs ?? 2_500;
  const outcome = options.outcome ?? defaultFixtureOutcome;
  let sequence = 0;
  const newId =
    options.newId ??
    (() => `demo-tts-job-${(++sequence).toString().padStart(4, '0')}`);
  const records = new Map<string, FixtureRecord>();
  const attempts = new Map<string, number>();

  function statusAt(record: FixtureRecord, at: number): TtsJobStatus {
    if (record.cancelled) return 'cancelled';
    const elapsed = at - record.createdAtMs;
    if (elapsed < queuedMs) return 'queued';
    if (elapsed < queuedMs + runningMs) return 'running';
    return record.outcome.status;
  }

  function advance(record: FixtureRecord): TtsGenerationJob {
    const at = now();
    const status = statusAt(record, at);
    if (status !== record.job.status) {
      record.job = {
        ...record.job,
        status,
        updatedAt: new Date(at).toISOString(),
      };
      if (status === 'failed' && record.outcome.status === 'failed')
        record.job.errorCode = record.outcome.errorCode;
    }
    return structuredClone(record.job);
  }

  function find(jobId: string): FixtureRecord {
    const record = records.get(jobId);
    if (!record) throw new Error('Không tìm thấy job tạo audio (demo).');
    return record;
  }

  return {
    mode: 'demo',
    async create(narrationId, input) {
      const key = `${narrationId}\u0000${input.locale}`;
      for (const record of records.values()) {
        const current = advance(record);
        if (
          `${current.narrationId}\u0000${record.locale}` === key &&
          !isTerminalTtsStatus(current.status)
        )
          return current; // idempotent: an in-flight job is returned as-is
      }
      const attempt = (attempts.get(key) ?? 0) + 1;
      attempts.set(key, attempt);
      const at = now();
      const timestamp = new Date(at).toISOString();
      const job: TtsGenerationJob = {
        id: newId(),
        narrationId,
        status: 'queued',
        provider: input.provider ?? 'piper',
        model: input.model ?? `demo-voice-${input.locale}`,
        modelVersion: 'demo-fixture-2026.10.0',
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      records.set(job.id, {
        job,
        locale: input.locale,
        createdAtMs: at,
        outcome: outcome({ narrationId, locale: input.locale, attempt }),
        cancelled: false,
      });
      return structuredClone(job);
    },
    async get(jobId) {
      return advance(find(jobId));
    },
    async cancel(jobId) {
      const record = find(jobId);
      const current = advance(record);
      if (isTerminalTtsStatus(current.status)) return current; // no-op on terminal jobs
      record.cancelled = true;
      return advance(record);
    },
    async previewAudio(job) {
      if (job.status !== 'succeeded' || !records.has(job.id)) return null;
      return new Blob([createDemoToneWav()], { type: 'audio/wav' });
    },
  };
}

type TtsSdk = Pick<
  DamSenApiClient,
  'createTtsJob' | 'getTtsJob' | 'cancelTtsJob'
>;

export function createHttpTtsGenerationPort(
  api: TtsSdk,
  token: () => string,
): TtsGenerationPort {
  return {
    mode: 'api',
    create: (narrationId, input) =>
      api.createTtsJob(narrationId, input, token()),
    get: (jobId) => api.getTtsJob(jobId, token()),
    cancel: (jobId) => api.cancelTtsJob(jobId, token()),
  };
}

export type TtsGenerationMode = 'off' | 'demo' | 'api';

/** Independent feature flag; generation stays hidden unless explicitly enabled. */
export function ttsGenerationMode(
  value = process.env.NEXT_PUBLIC_TTS_GENERATION_MODE,
): TtsGenerationMode {
  if (value === 'demo' || value === 'test') return 'demo';
  if (value === 'api') return 'api';
  return 'off';
}

let port: TtsGenerationPort | null | undefined;
export function getTtsGenerationPort(): TtsGenerationPort | null {
  if (port !== undefined) return port;
  const mode = ttsGenerationMode();
  port =
    mode === 'demo'
      ? createFixtureTtsGenerationPort()
      : mode === 'api'
        ? createHttpTtsGenerationPort(
            new DamSenApiClient({ baseUrl: apiBase }),
            requireAccessToken,
          )
        : null;
  return port;
}

/** Maps transport failures to user-facing Vietnamese text without leaking internals. */
export function ttsRequestErrorMessage(cause: unknown): string {
  if (cause instanceof ApiClientError) {
    if (cause.status === 401)
      return 'Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.';
    if (cause.status === 403) return 'Tài khoản không có quyền tạo audio AI.';
    if (cause.status === 404)
      return 'Không tìm thấy bản thuyết minh hoặc job tạo audio.';
    if (cause.status === 409)
      return 'Trạng thái bản thuyết minh không cho phép thao tác này.';
    if (cause.status === 429) return 'Đã vượt hạn mức tạo audio. Thử lại sau.';
    return `Máy chủ không xử lý được yêu cầu (HTTP ${cause.status}).`;
  }
  return cause instanceof Error
    ? cause.message
    : 'Không thể kết nối dịch vụ tạo audio.';
}
