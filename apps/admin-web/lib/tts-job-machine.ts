import type {
  AdminNarration,
  TtsGenerationJob,
  TtsJobStatus,
  UserRole,
} from '@damsen/shared-types';
import { isTerminalTtsStatus } from './tts-generation';

/** UI state for one narration's AI generation, independent of the transport. */
export interface TtsJobUiState {
  phase: 'idle' | 'creating' | 'tracking' | 'cancelling';
  job: TtsGenerationJob | null;
  error: string;
  pollAttempt: number;
  pollFailures: number;
}

export type TtsJobEvent =
  | { type: 'create_requested' }
  | { type: 'job_received'; job: TtsGenerationJob }
  | { type: 'cancel_requested' }
  | { type: 'request_failed'; error: string }
  | { type: 'poll_failed'; error: string }
  | { type: 'resume_polling' }
  /** Back to idle, or resume tracking a job still in flight for this narration. */
  | { type: 'reset'; job?: TtsGenerationJob | null };

export const MAX_POLL_FAILURES = 3;

export const initialTtsJobState: TtsJobUiState = {
  phase: 'idle',
  job: null,
  error: '',
  pollAttempt: 0,
  pollFailures: 0,
};

export function ttsJobReducer(
  state: TtsJobUiState,
  event: TtsJobEvent,
): TtsJobUiState {
  switch (event.type) {
    case 'create_requested':
      if (state.phase === 'creating' || isActive(state)) return state;
      return { ...initialTtsJobState, phase: 'creating', job: state.job };
    case 'job_received': {
      const current = state.job;
      // Ignore stale responses: nothing requested, other jobs, or anything
      // after a terminal state. Only a pending create may introduce a job.
      if (
        state.phase !== 'creating' &&
        (!current ||
          current.id !== event.job.id ||
          isTerminalTtsStatus(current.status))
      )
        return state;
      const terminal = isTerminalTtsStatus(event.job.status);
      return {
        phase: terminal ? 'idle' : 'tracking',
        job: event.job,
        error: '',
        pollAttempt: state.phase === 'creating' ? 0 : state.pollAttempt + 1,
        pollFailures: 0,
      };
    }
    case 'cancel_requested':
      return canCancelJob(state)
        ? { ...state, phase: 'cancelling', error: '' }
        : state;
    case 'request_failed':
      return {
        ...state,
        phase:
          state.job && !isTerminalTtsStatus(state.job.status)
            ? 'tracking'
            : 'idle',
        error: event.error,
      };
    case 'poll_failed': {
      const pollFailures = state.pollFailures + 1;
      return {
        ...state,
        pollFailures,
        pollAttempt: state.pollAttempt + 1,
        error: pollFailures >= MAX_POLL_FAILURES ? event.error : '',
      };
    }
    case 'resume_polling':
      return { ...state, pollFailures: 0, error: '' };
    case 'reset':
      return trackingStateFor(event.job);
  }
}

/** Initial state for a narration: idle, or tracking a job that is still in flight. */
export function trackingStateFor(
  job: TtsGenerationJob | null | undefined,
): TtsJobUiState {
  return job && !isTerminalTtsStatus(job.status)
    ? { ...initialTtsJobState, phase: 'tracking', job }
    : initialTtsJobState;
}

function isActive(state: TtsJobUiState) {
  return Boolean(state.job && !isTerminalTtsStatus(state.job.status));
}

/** Polling runs only while a non-terminal job is tracked and failures are below the cap. */
export function shouldPoll(state: TtsJobUiState): boolean {
  return (
    (state.phase === 'tracking' || state.phase === 'cancelling') &&
    isActive(state) &&
    state.pollFailures < MAX_POLL_FAILURES
  );
}

export function nextPollDelayMs(attempt: number): number {
  return Math.min(5_000, Math.round(800 * 1.5 ** Math.max(0, attempt)));
}

/**
 * A create/cancel request is pending or the job is not terminal yet. While this
 * holds, the draft must not be saved or submitted: the generated audio would
 * attach to a revision whose transcript or workflow state has moved on.
 */
export function isTtsJobInFlight(state: TtsJobUiState): boolean {
  return (
    state.phase === 'creating' ||
    state.phase === 'cancelling' ||
    isActive(state)
  );
}

/**
 * Jobs still in flight, per narration, for this page session. Contract v1 has
 * no "latest job for a narration" endpoint, so without this a locale-tab switch
 * (which remounts the editor) would forget a running job, stop polling and let
 * the draft be submitted while generation is still writing to it.
 */
const inFlightJobs = new Map<string, TtsGenerationJob>();

export function rememberTtsJob(job: TtsGenerationJob | null | undefined) {
  if (!job) return;
  if (isTerminalTtsStatus(job.status)) inFlightJobs.delete(job.narrationId);
  else inFlightJobs.set(job.narrationId, job);
}

export function inFlightTtsJob(narrationId: string | undefined) {
  return narrationId ? (inFlightJobs.get(narrationId) ?? null) : null;
}

export const TTS_IN_FLIGHT_REASON =
  'Đang tạo audio AI cho bản nháp này. Chờ hoàn tất hoặc huỷ trước khi lưu hay gửi duyệt.';

export function canCancelJob(state: TtsJobUiState): boolean {
  return state.phase === 'tracking' && isActive(state);
}

export function canRetryJob(state: TtsJobUiState): boolean {
  return (
    state.phase === 'idle' &&
    (state.job?.status === 'failed' || state.job?.status === 'cancelled')
  );
}

export const TTS_STATUS_LABELS: Record<TtsJobStatus, string> = {
  queued: 'Đang chờ xử lý',
  running: 'Đang tạo audio',
  succeeded: 'Đã tạo xong audio AI (chỉ cho bản nháp, chưa xuất bản)',
  failed: 'Tạo audio thất bại',
  cancelled: 'Đã huỷ tạo audio',
};

const ERROR_LABELS: Record<string, string> = {
  TTS_TIMEOUT: 'Quá thời gian tạo audio.',
  TTS_AUDIO_INVALID: 'Audio tạo ra không đạt kiểm tra chất lượng.',
  TTS_PROVIDER_ERROR: 'Dịch vụ TTS gặp lỗi.',
  TTS_LOCALE_UNSUPPORTED: 'Chưa có giọng đọc cho ngôn ngữ này.',
  TTS_TRANSCRIPT_STALE: 'Nội dung đã thay đổi sau khi tạo; hãy tạo lại.',
  AI_FEATURE_DISABLED: 'Tính năng tạo audio AI đang tạm tắt (kill switch).',
};

/** A queued job older than this suggests no worker is consuming the queue. */
export const QUEUED_STALL_MS = 120_000;

/**
 * `queuedSinceMs` should come from the same clock as `nowMs` (the panel uses
 * the time it first saw this queued state); `updatedAt` is only a fallback
 * because the server and browser clocks may differ.
 */
export function isQueuedStalled(
  job: Pick<TtsGenerationJob, 'status' | 'updatedAt'> | null | undefined,
  nowMs: number,
  queuedSinceMs?: number,
): boolean {
  if (job?.status !== 'queued') return false;
  const since = queuedSinceMs ?? Date.parse(job.updatedAt);
  return Number.isFinite(since) && nowMs - since >= QUEUED_STALL_MS;
}

/** Only stable error codes are shown; unknown codes stay generic. */
export function ttsErrorLabel(errorCode?: string): string {
  if (!errorCode) return 'Không rõ nguyên nhân.';
  return ERROR_LABELS[errorCode] ?? 'Lỗi không xác định.';
}

export interface TtsGenerationGuardInput {
  roles: UserRole[];
  narration?: Pick<AdminNarration, 'id' | 'status' | 'locale'>;
  isNewRevision: boolean;
  hasUnsavedChanges: boolean;
  localeEnabled: boolean;
}

export interface TtsGenerationGuard {
  /** The generation section is rendered at all. */
  visible: boolean;
  canGenerate: boolean;
  reason: string;
}

/**
 * UI visibility/action guard. Backend RBAC stays authoritative; this only hides
 * actions a role cannot use and explains why a button is disabled.
 */
export function ttsGenerationGuard({
  roles,
  narration,
  isNewRevision,
  hasUnsavedChanges,
  localeEnabled,
}: TtsGenerationGuardInput): TtsGenerationGuard {
  const canEdit = roles.includes('EDITOR') || roles.includes('ADMIN');
  const canReview = roles.includes('REVIEWER') || roles.includes('ADMIN');
  if (!canEdit && !canReview)
    return { visible: false, canGenerate: false, reason: '' };
  const deny = (reason: string) => ({
    visible: true,
    canGenerate: false,
    reason,
  });
  if (!canEdit) return deny('Chỉ editor hoặc admin được tạo audio AI.');
  if (!localeEnabled) return deny('Ngôn ngữ này đang tắt trong cấu hình.');
  if (!narration || isNewRevision)
    return deny('Lưu bản nháp thuyết minh trước khi tạo audio AI.');
  if (narration.status !== 'draft' && narration.status !== 'rejected')
    return deny('Chỉ tạo audio cho bản nháp hoặc bản bị từ chối.');
  if (hasUnsavedChanges)
    return deny(
      'Lưu thay đổi nội dung trước; audio phải khớp transcript đã lưu.',
    );
  return { visible: true, canGenerate: true, reason: '' };
}
