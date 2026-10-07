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
  | { type: 'reset' };

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
      // Ignore stale responses: other jobs, or anything after a terminal state.
      if (
        current &&
        state.phase !== 'creating' &&
        (current.id !== event.job.id || isTerminalTtsStatus(current.status))
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
      return initialTtsJobState;
  }
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
  succeeded: 'Đã tạo xong — audio được gắn vào bản nháp',
  failed: 'Tạo audio thất bại',
  cancelled: 'Đã huỷ tạo audio',
};

const ERROR_LABELS: Record<string, string> = {
  TTS_TIMEOUT: 'Quá thời gian tạo audio.',
  TTS_AUDIO_INVALID: 'Audio tạo ra không đạt kiểm tra chất lượng.',
  TTS_PROVIDER_ERROR: 'Dịch vụ TTS gặp lỗi.',
  TTS_LOCALE_UNSUPPORTED: 'Chưa có giọng đọc cho ngôn ngữ này.',
  TTS_TRANSCRIPT_STALE: 'Nội dung đã thay đổi sau khi tạo; hãy tạo lại.',
};

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
