import type { TtsJobRecord, TtsJobStatus } from './types.js';

/**
 * Queue port for the worker's TTS consumer (I02, ADR 0014).
 *
 * The admin API writes `queued` rows into `tts_generation_jobs`; the worker
 * claims them atomically, runs synthesis and, on success, stores the audio and
 * attaches it to the DRAFT narration in the same transaction that marks the job
 * `succeeded`. Every write after the claim is conditional on the row still
 * being `running`, so a cancel issued through the API while a job runs always
 * wins (the worker never overwrites `cancelled`).
 */

/** Narration fields the worker needs to synthesize and attach. Never logged. */
export interface TtsNarrationSnapshot {
  id: string;
  poiId: string;
  locale: string;
  /** Current transcript text. Never logged or persisted by the worker. */
  transcript: string;
  /** Narration workflow status (`draft`, `pending_review`, ...). */
  status: string;
}

export interface ClaimedTtsJob {
  /** The job, already transitioned to `running` by the claim. */
  job: TtsJobRecord;
  narration: TtsNarrationSnapshot;
}

/** AI provenance stored with the narration's current audio. */
export interface TtsAudioProvenance {
  provider: string;
  model: string;
  modelVersion: string;
  voiceId: string;
  license: string;
  jobId: string;
  generatedAt: string;
}

/** Audio metadata written to the draft narration (`poi_narrations.audio_*`). */
export interface DraftAudioAttachment {
  objectKey: string;
  mimeType: 'audio/wav';
  sizeBytes: number;
  sha256: string;
  durationSeconds: number;
  rightsOwner: string;
  rightsSource: string;
  usageRights: string;
  generatedBy: TtsAudioProvenance;
}

/**
 * - `succeeded`: job marked succeeded and audio attached, atomically.
 * - `not_running`: the job left `running` (cancelled) — nothing was written.
 * - `narration_not_draft`: the narration was submitted/published meanwhile.
 * - `transcript_changed`: the transcript no longer matches the job's hash.
 */
export type TtsCompletionOutcome =
  | 'succeeded'
  | 'not_running'
  | 'narration_not_draft'
  | 'transcript_changed';

export interface TtsJobQueue {
  /**
   * Atomically claim the oldest `queued` job (or a `running` job whose worker
   * stopped heart-beating for longer than the stale window) and move it to
   * `running` with `attempts = 0` and a cleared `errorCode`. Concurrent
   * workers never claim the same row.
   */
  claimNext(): Promise<ClaimedTtsJob | null>;
  /**
   * Persist progress (attempts, errorCode, terminal `failed`) only while the
   * row is still `running`. Returns false when the job was cancelled.
   */
  updateRunning(record: TtsJobRecord): Promise<boolean>;
  /** See {@link TtsCompletionOutcome}. `record.status` must be `succeeded`. */
  completeWithDraftAudio(
    record: TtsJobRecord,
    attachment: DraftAudioAttachment,
    transcriptHashOf: (transcript: string) => string,
  ): Promise<TtsCompletionOutcome>;
  findById(id: string): Promise<TtsJobRecord | null>;
  /** Queue depth by status, for the `tts_queue_depth` gauge. */
  countByStatus(): Promise<Partial<Record<TtsJobStatus, number>>>;
}
