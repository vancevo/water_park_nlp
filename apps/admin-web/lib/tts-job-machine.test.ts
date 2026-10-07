import type { TtsGenerationJob, TtsJobStatus } from '@damsen/shared-types';
import { describe, expect, it } from 'vitest';
import {
  MAX_POLL_FAILURES,
  canCancelJob,
  canRetryJob,
  initialTtsJobState,
  nextPollDelayMs,
  shouldPoll,
  ttsErrorLabel,
  ttsGenerationGuard,
  ttsJobReducer,
  type TtsJobEvent,
  type TtsJobUiState,
} from './tts-job-machine';

const job = (status: TtsJobStatus, id = 'j1'): TtsGenerationJob => ({
  id,
  narrationId: 'n1',
  status,
  provider: 'piper',
  model: 'm',
  modelVersion: 'v1',
  createdAt: '2026-10-07T00:00:00.000Z',
  updatedAt: '2026-10-07T00:00:00.000Z',
  ...(status === 'failed' ? { errorCode: 'TTS_TIMEOUT' } : {}),
});

const run = (events: TtsJobEvent[], from: TtsJobUiState = initialTtsJobState) =>
  events.reduce(ttsJobReducer, from);

describe('TTS job UI state machine', () => {
  it('tracks create → queued → running → succeeded and stops polling', () => {
    let state = run([{ type: 'create_requested' }]);
    expect(state.phase).toBe('creating');
    expect(shouldPoll(state)).toBe(false);
    state = run([{ type: 'job_received', job: job('queued') }], state);
    expect(state.phase).toBe('tracking');
    expect(shouldPoll(state)).toBe(true);
    expect(canCancelJob(state)).toBe(true);
    state = run([{ type: 'job_received', job: job('running') }], state);
    expect(state.pollAttempt).toBe(1);
    state = run([{ type: 'job_received', job: job('succeeded') }], state);
    expect(state.phase).toBe('idle');
    expect(shouldPoll(state)).toBe(false);
    expect(canRetryJob(state)).toBe(false);
  });

  it('ignores stale responses after a terminal state or for another job', () => {
    const done = run([
      { type: 'create_requested' },
      { type: 'job_received', job: job('queued') },
      { type: 'job_received', job: job('cancelled') },
    ]);
    expect(
      run([{ type: 'job_received', job: job('running') }], done).job?.status,
    ).toBe('cancelled');
    const tracking = run([
      { type: 'create_requested' },
      { type: 'job_received', job: job('queued') },
    ]);
    expect(
      run([{ type: 'job_received', job: job('running', 'other') }], tracking)
        .job?.id,
    ).toBe('j1');
  });

  it('cancels only an active job and restores tracking if cancel fails', () => {
    const tracking = run([
      { type: 'create_requested' },
      { type: 'job_received', job: job('running') },
    ]);
    const cancelling = run([{ type: 'cancel_requested' }], tracking);
    expect(cancelling.phase).toBe('cancelling');
    expect(shouldPoll(cancelling)).toBe(true);
    const failed = run([{ type: 'request_failed', error: 'x' }], cancelling);
    expect(failed).toMatchObject({ phase: 'tracking', error: 'x' });
    const cancelled = run(
      [{ type: 'job_received', job: job('cancelled') }],
      cancelling,
    );
    expect(canRetryJob(cancelled)).toBe(true);
    expect(run([{ type: 'cancel_requested' }], cancelled)).toBe(cancelled);
  });

  it('allows retry after failure and replaces the job on the next create', () => {
    const failed = run([
      { type: 'create_requested' },
      { type: 'job_received', job: job('failed') },
    ]);
    expect(canRetryJob(failed)).toBe(true);
    const retrying = run([{ type: 'create_requested' }], failed);
    expect(retrying.phase).toBe('creating');
    const next = run(
      [{ type: 'job_received', job: job('queued', 'j2') }],
      retrying,
    );
    expect(next.job?.id).toBe('j2');
    expect(next.phase).toBe('tracking');
  });

  it('blocks duplicate create while a job is active and surfaces create errors', () => {
    const tracking = run([
      { type: 'create_requested' },
      { type: 'job_received', job: job('queued') },
    ]);
    expect(run([{ type: 'create_requested' }], tracking)).toBe(tracking);
    const failedCreate = run([
      { type: 'create_requested' },
      { type: 'request_failed', error: 'denied' },
    ]);
    expect(failedCreate).toMatchObject({
      phase: 'idle',
      error: 'denied',
      job: null,
    });
  });

  it('stops polling after repeated poll failures until resumed', () => {
    let state = run([
      { type: 'create_requested' },
      { type: 'job_received', job: job('queued') },
    ]);
    for (let index = 0; index < MAX_POLL_FAILURES - 1; index += 1)
      state = run([{ type: 'poll_failed', error: 'offline' }], state);
    expect(shouldPoll(state)).toBe(true);
    expect(state.error).toBe('');
    state = run([{ type: 'poll_failed', error: 'offline' }], state);
    expect(shouldPoll(state)).toBe(false);
    expect(state.error).toBe('offline');
    state = run([{ type: 'resume_polling' }], state);
    expect(shouldPoll(state)).toBe(true);
  });

  it('backs off polling up to five seconds', () => {
    expect(nextPollDelayMs(0)).toBe(800);
    expect(nextPollDelayMs(1)).toBe(1200);
    expect(nextPollDelayMs(20)).toBe(5000);
  });

  it('shows only stable error labels', () => {
    expect(ttsErrorLabel('TTS_TIMEOUT')).toBe('Quá thời gian tạo audio.');
    expect(ttsErrorLabel('SOMETHING_ELSE')).toBe('Lỗi không xác định.');
    expect(ttsErrorLabel()).toBe('Không rõ nguyên nhân.');
  });
});

describe('TTS generation RBAC/visibility guard', () => {
  const base = {
    narration: { id: 'n1', status: 'draft' as const, locale: 'vi' },
    isNewRevision: false,
    hasUnsavedChanges: false,
    localeEnabled: true,
  };

  it('hides generation from visitors and denies it to reviewer-only accounts', () => {
    expect(ttsGenerationGuard({ ...base, roles: ['VISITOR'] }).visible).toBe(
      false,
    );
    expect(ttsGenerationGuard({ ...base, roles: [] }).visible).toBe(false);
    const reviewer = ttsGenerationGuard({ ...base, roles: ['REVIEWER'] });
    expect(reviewer).toMatchObject({ visible: true, canGenerate: false });
  });

  it('lets editors and admins generate for a saved draft or rejected revision', () => {
    expect(ttsGenerationGuard({ ...base, roles: ['EDITOR'] }).canGenerate).toBe(
      true,
    );
    expect(
      ttsGenerationGuard({
        ...base,
        roles: ['ADMIN'],
        narration: { ...base.narration, status: 'rejected' },
      }).canGenerate,
    ).toBe(true);
  });

  it('blocks published/pending, unsaved, unsaved-new and disabled-locale cases', () => {
    const editor = { ...base, roles: ['EDITOR' as const] };
    for (const status of ['pending_review', 'published', 'superseded'] as const)
      expect(
        ttsGenerationGuard({
          ...editor,
          narration: { ...base.narration, status },
        }).canGenerate,
      ).toBe(false);
    expect(
      ttsGenerationGuard({ ...editor, hasUnsavedChanges: true }).reason,
    ).toContain('Lưu thay đổi');
    expect(
      ttsGenerationGuard({ ...editor, isNewRevision: true }).canGenerate,
    ).toBe(false);
    expect(
      ttsGenerationGuard({ ...editor, narration: undefined }).canGenerate,
    ).toBe(false);
    expect(
      ttsGenerationGuard({ ...editor, localeEnabled: false }).reason,
    ).toContain('đang tắt');
  });
});
