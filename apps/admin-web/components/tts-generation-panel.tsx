'use client';

import type {
  AdminNarration,
  NarrationLocaleOption,
  TtsGenerationJob,
  TtsJobStatus,
  UserRole,
} from '@damsen/shared-types';
import { useEffect, useId, useState } from 'react';
import type { useTtsJob } from '@/hooks/use-tts-job';
import {
  isTerminalTtsStatus,
  type TtsGenerationPort,
} from '@/lib/tts-generation';
import {
  TTS_STATUS_LABELS,
  canCancelJob,
  canRetryJob,
  isQueuedStalled,
  ttsErrorLabel,
  ttsGenerationGuard,
} from '@/lib/tts-job-machine';

const STEPS: { status: TtsJobStatus; label: string }[] = [
  { status: 'queued', label: 'Xếp hàng' },
  { status: 'running', label: 'Đang tạo' },
  { status: 'succeeded', label: 'Hoàn tất' },
];

/**
 * AI narration audio for one saved draft revision. Output is always a draft
 * attachment: this panel never submits, approves or publishes, and it labels
 * everything it shows as AI-generated with provider/model/version provenance.
 * The job state (`useTtsJob`) is owned by the editor so it can block save and
 * submit while a job is in flight.
 */
export function TtsGenerationPanel({
  port,
  tts,
  narration,
  isNewRevision,
  localeOption,
  roles,
  hasUnsavedChanges,
}: {
  port: TtsGenerationPort;
  tts: ReturnType<typeof useTtsJob>;
  narration?: AdminNarration;
  isNewRevision: boolean;
  localeOption: NarrationLocaleOption;
  roles: UserRole[];
  hasUnsavedChanges: boolean;
}) {
  const headingId = useId();
  const guard = ttsGenerationGuard({
    roles,
    narration,
    isNewRevision,
    hasUnsavedChanges,
    localeEnabled: true,
  });
  const { state, generate, cancel, resume } = tts;
  const job = state.job;
  const previewUrl = usePreviewUrl(port, job);
  const stalled = useQueuedStall(job);
  if (!guard.visible) return null;

  const active = Boolean(job && !isTerminalTtsStatus(job.status));
  const busy = state.phase === 'creating' || state.phase === 'cancelling';
  const statusText =
    state.phase === 'creating'
      ? 'Đang gửi yêu cầu tạo audio…'
      : state.phase === 'cancelling'
        ? 'Đang huỷ…'
        : job
          ? `${TTS_STATUS_LABELS[job.status]}${
              job.status === 'failed'
                ? ` — ${ttsErrorLabel(job.errorCode)}`
                : ''
            }`
          : '';
  const stepIndex = job
    ? STEPS.findIndex((step) => step.status === job.status)
    : -1;

  return (
    <section className="tts-generation" aria-labelledby={headingId}>
      <div className="section-heading">
        <div>
          <h4 id={headingId}>
            Audio AI cho bản nháp · {localeOption.nativeLabel}
          </h4>
          <p>
            Audio tạo bằng AI chỉ được gắn vào bản nháp. Editor nghe thử, gửi
            duyệt; chỉ reviewer mới xuất bản. Không bao giờ tự động xuất bản.
          </p>
        </div>
        <span className="ai-badge" title="Nội dung được tạo bởi AI">
          AI-generated
        </span>
      </div>
      {port.mode === 'demo' && (
        <p className="helper demo-note">
          Chế độ demo: job được mô phỏng trên trình duyệt, audio nghe thử là âm
          báo tổng hợp, không phải giọng đọc thật.
        </p>
      )}
      {guard.reason && (
        <p className="helper" id={`${headingId}-reason`}>
          {guard.reason}
        </p>
      )}
      {hasUnsavedChanges && job && (active || job.status === 'succeeded') && (
        <p className="alert error" role="alert">
          Nội dung đã thay đổi sau khi tạo audio. Audio sẽ không khớp transcript
          — hãy lưu rồi tạo lại.
        </p>
      )}
      <div className="button-row">
        {!canRetryJob(state) && (
          <button
            type="button"
            className="button primary"
            disabled={!guard.canGenerate || busy || active}
            aria-describedby={guard.reason ? `${headingId}-reason` : undefined}
            onClick={() => void generate(localeOption.code)}
          >
            {job?.status === 'succeeded' ? 'Tạo lại audio AI' : 'Tạo audio AI'}
          </button>
        )}
        {canRetryJob(state) && (
          <button
            type="button"
            className="button primary"
            disabled={!guard.canGenerate || busy}
            onClick={() => void generate(localeOption.code)}
          >
            Thử lại
          </button>
        )}
        {active && (
          <button
            type="button"
            className="button ghost"
            disabled={!canCancelJob(state)}
            onClick={() => void cancel()}
          >
            Huỷ tạo audio
          </button>
        )}
      </div>
      <div
        className="tts-status"
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        {statusText}
        {/* Inside the live region so screen readers hear the hint too. */}
        {stalled && ' '}
        {stalled && (
          <span className="helper tts-stall">
            Job đã chờ hơn 2 phút mà chưa được xử lý. Máy chủ có thể chưa chạy
            worker tạo audio; bạn có thể huỷ và thử lại sau.
          </span>
        )}
      </div>
      {job && job.status !== 'failed' && job.status !== 'cancelled' && (
        <ol className="tts-steps" aria-label="Tiến trình tạo audio">
          {STEPS.map((step, index) => (
            <li
              key={step.status}
              className={
                index < stepIndex
                  ? 'done'
                  : index === stepIndex
                    ? 'current'
                    : ''
              }
              aria-current={index === stepIndex ? 'step' : undefined}
            >
              {step.label}
            </li>
          ))}
        </ol>
      )}
      {state.error && (
        <div className="alert error" role="alert">
          <span>{state.error}</span>
          {active && (
            <button type="button" className="link-button" onClick={resume}>
              Kiểm tra lại
            </button>
          )}
        </div>
      )}
      {job && (
        <dl className="tts-provenance" aria-label="Nguồn gốc audio AI">
          <div>
            <dt>Nhà cung cấp</dt>
            <dd>{job.provider}</dd>
          </div>
          <div>
            <dt>Model</dt>
            <dd>{job.model}</dd>
          </div>
          <div>
            <dt>Phiên bản model</dt>
            <dd>{job.modelVersion}</dd>
          </div>
          <div>
            <dt>Cập nhật</dt>
            <dd>
              <time dateTime={job.updatedAt}>
                {new Date(job.updatedAt).toLocaleString('vi-VN')}
              </time>
            </dd>
          </div>
        </dl>
      )}
      {job?.status === 'succeeded' && (
        <div className="audio-preview ai-preview">
          <b>
            <span className="ai-badge">AI-generated</span>{' '}
            {previewUrl ? 'Nghe thử trước khi gửi duyệt' : 'Kết quả tạo audio'}
          </b>
          {previewUrl ? (
            <audio controls src={previewUrl} lang={localeOption.code} />
          ) : (
            <small>
              {narration?.audio
                ? 'Máy chủ chưa cung cấp đường dẫn nghe thử audio AI. Bản nháp đang có audio đính kèm; kiểm tra lại đó có phải audio AI không trước khi gửi duyệt.'
                : 'Máy chủ chưa cung cấp đường dẫn nghe thử và chưa gắn audio AI vào bản nháp này. Bản nháp vẫn chỉ có văn bản; chưa thể gửi duyệt kèm audio AI.'}
            </small>
          )}
          <small>
            {job.provider} · {job.model} · {job.modelVersion}
          </small>
        </div>
      )}
    </section>
  );
}

/**
 * True once a tracked job has sat in `queued` for QUEUED_STALL_MS as observed
 * by this page (client clock only, so server/browser clock skew cannot trigger
 * or suppress it). A re-enqueue (new `updatedAt`) restarts the window.
 * Re-checked every 15 s.
 */
function useQueuedStall(job: TtsGenerationJob | null) {
  const key = job?.status === 'queued' ? `${job.id}|${job.updatedAt}` : '';
  const [tick, setTick] = useState({ key: '', since: 0, now: 0 });
  useEffect(() => {
    if (!key) return;
    const since = Date.now();
    const timer = window.setInterval(
      () => setTick({ key, since, now: Date.now() }),
      15_000,
    );
    return () => window.clearInterval(timer);
  }, [key]);
  return tick.key === key && isQueuedStalled(job, tick.now, tick.since);
}

/** Object URL for a local preview blob, revoked when the job changes or unmounts. */
function usePreviewUrl(port: TtsGenerationPort, job: TtsGenerationJob | null) {
  const [url, setUrl] = useState('');
  const jobId = job?.status === 'succeeded' ? job.id : undefined;
  useEffect(() => {
    if (!jobId || !port.previewAudio) return;
    let objectUrl = '';
    let cancelled = false;
    void port
      .previewAudio(job!)
      .then((blob) => {
        if (cancelled || !blob) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
      setUrl('');
    };
    // Re-run only when a different job succeeds; `job` is read at that moment.
  }, [jobId, port]);
  return url;
}
