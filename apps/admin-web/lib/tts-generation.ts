import { ApiClientError, DamSenApiClient } from '@damsen/api-client';
import type {
  CreateTtsJobRequest,
  TtsGenerationJob,
  TtsJobArtifactSummary,
  TtsJobStatus,
} from '@damsen/shared-types';
import { apiBase } from './api-poi-client';
import { requireAccessToken } from './auth-session';
import { createDemoToneWav } from './demo-wav';

/**
 * App-local port for admin TTS jobs (contract v1.1, ADR 0014):
 * POST /v1/admin/narrations/:narrationId/tts-jobs, GET /v1/admin/tts-jobs/:jobId,
 * POST /v1/admin/tts-jobs/:jobId/cancel and
 * GET /v1/admin/narrations/:narrationId/tts-jobs/latest. Retry is a new create
 * call; the backend idempotency key decides whether a failed job is re-run.
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
   * Most recent job of a narration (`null` when none), so tracking resumes
   * after a page reload. Optional: an adapter without it falls back to the
   * page-session in-flight registry only.
   */
  latest?(narrationId: string): Promise<TtsGenerationJob | null>;
  /**
   * Demo-only local preview of a succeeded job (a synthetic tone). The API
   * adapter omits it: since contract v1.1 the worker attaches the audio to the
   * draft and the editor plays it through the narration playback endpoint.
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
      if (status === 'succeeded') record.job.artifact = demoArtifact(record);
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
    async latest(narrationId) {
      let newest: FixtureRecord | undefined;
      for (const record of records.values())
        if (
          record.job.narrationId === narrationId &&
          (!newest || record.createdAtMs >= newest.createdAtMs)
        )
          newest = record;
      return newest ? advance(newest) : null;
    },
    async previewAudio(job) {
      if (job.status !== 'succeeded' || !records.has(job.id)) return null;
      return new Blob([createDemoToneWav()], { type: 'audio/wav' });
    },
  };
}

/**
 * v1.1 `artifact` for the demo tone (`createDemoToneWav` defaults: 1.2 s,
 * 16 kHz mono). Not a voice and never uploaded; the all-zero hash marks it as
 * synthetic.
 */
function demoArtifact(record: FixtureRecord): TtsJobArtifactSummary {
  return {
    voiceId: `demo-tone-${record.locale}`,
    license: 'demo-synthetic-tone (no voice model)',
    audioSha256: '0'.repeat(64),
    sizeBytes: 44 + 1.2 * 16_000 * 2,
    durationSeconds: 1.2,
    sampleRateHz: 16_000,
    mimeType: 'audio/wav',
  };
}

type TtsSdk = Pick<
  DamSenApiClient,
  'createTtsJob' | 'getTtsJob' | 'cancelTtsJob' | 'getLatestTtsJob'
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
    latest: async (narrationId) =>
      (await api.getLatestTtsJob(narrationId, token())).job,
  };
}

export type TtsGenerationMode = 'off' | 'demo' | 'api';

/**
 * Independent build-time feature flag; fails closed. Only an explicit `api`
 * (or `demo`/`test`) shows the panel: a missing, empty or unrecognised value
 * stays `off`. The real endpoints were verified end to end at I03 (real worker,
 * draft attach, AI08 kill switch/quota; see
 * docs/runbooks/frontend-i03-acceptance-report.md), but turning generation on
 * for a release is the I04 gate's call: there is no production voice yet and
 * the backend kill switch defaults to enabled, so a default `api` build would
 * offer editors a button whose jobs can only fail.
 */
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

/**
 * Stable request-level error codes of the AI04 endpoints and the AI08 controls
 * (contract v1.1, ADR 0014). Messages are user-facing Vietnamese; the server
 * message is never shown because it can contain internal detail (validation
 * paths, locale strings).
 */
const REQUEST_ERROR_LABELS: Record<string, string> = {
  NARRATION_LOCALE_DISABLED:
    'Ngôn ngữ này đang tắt trong cấu hình nên không thể tạo audio AI.',
  TTS_JOB_LOCALE_MISMATCH:
    'Ngôn ngữ yêu cầu không khớp ngôn ngữ của bản thuyết minh. Tải lại trang rồi thử lại.',
  TTS_JOB_TRANSCRIPT_EMPTY: 'Bản thuyết minh chưa có nội dung để tạo audio.',
  TTS_VOICE_UNAVAILABLE:
    'Chưa có giọng đọc AI được cấu hình cho ngôn ngữ này. Liên hệ quản trị.',
  NARRATION_NOT_DRAFT:
    'Chỉ tạo audio AI cho bản nháp. Bản thuyết minh này đã được gửi duyệt hoặc xuất bản — tải lại trang để xem trạng thái mới.',
  TTS_JOB_IN_PROGRESS:
    'Bản nháp đang có một job tạo audio AI chưa xong. Chờ hoàn tất hoặc huỷ trước.',
  AI_FEATURE_DISABLED:
    'Tính năng tạo audio AI đang tạm tắt (kill switch). Thử lại sau hoặc liên hệ quản trị.',
  rate_limited: 'Đã vượt hạn mức tạo audio.',
  concurrency_limited:
    'Đang có quá nhiều job tạo audio chờ hoặc chạy cùng lúc.',
};

/** "Thử lại sau …" from a 429 `details.retryAfterSeconds`, else a generic hint. */
export function retryAfterHint(details: unknown): string {
  const seconds =
    details && typeof details === 'object' && 'retryAfterSeconds' in details
      ? Number((details as { retryAfterSeconds: unknown }).retryAfterSeconds)
      : NaN;
  if (!Number.isFinite(seconds) || seconds <= 0) return 'Thử lại sau ít phút.';
  if (seconds < 90) return `Thử lại sau khoảng ${Math.ceil(seconds)} giây.`;
  return `Thử lại sau khoảng ${Math.ceil(seconds / 60)} phút.`;
}

/** Maps transport failures to user-facing Vietnamese text without leaking internals. */
export function ttsRequestErrorMessage(cause: unknown): string {
  if (cause instanceof ApiClientError) {
    const code = cause.body?.code ?? '';
    const known = REQUEST_ERROR_LABELS[code];
    if (
      cause.status === 429 ||
      code === 'rate_limited' ||
      code === 'concurrency_limited'
    )
      return `${known ?? REQUEST_ERROR_LABELS.rate_limited} ${retryAfterHint(cause.body?.details)}`;
    if (known) return known;
    if (cause.status === 400)
      return 'Yêu cầu tạo audio không hợp lệ. Tải lại trang rồi thử lại.';
    if (cause.status === 401)
      return 'Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại.';
    if (cause.status === 403) return 'Tài khoản không có quyền tạo audio AI.';
    if (cause.status === 404)
      return 'Không tìm thấy bản thuyết minh hoặc job tạo audio (job cũ có thể đã bị dọn theo chính sách lưu trữ).';
    if (cause.status === 409)
      return 'Trạng thái bản thuyết minh không cho phép thao tác này. Tải lại trang để xem trạng thái mới.';
    if (cause.status === 503)
      return 'Dịch vụ tạo audio AI đang tạm ngừng. Thử lại sau.';
    return `Máy chủ không xử lý được yêu cầu (HTTP ${cause.status}).`;
  }
  // Network failures surface as TypeError ("Failed to fetch") and a non-JSON
  // error page (proxy/gateway HTML) as SyntaxError from the client's
  // `response.json()`; neither message is user-facing. App-level errors (e.g.
  // missing session) already carry Vietnamese text.
  return cause instanceof Error &&
    !(cause instanceof TypeError) &&
    !(cause instanceof SyntaxError)
    ? cause.message
    : 'Không thể kết nối dịch vụ tạo audio.';
}
