import type { TtsJobRecord, TtsJobStatus } from './types.js';

/**
 * Queue port for the worker's TTS consumer (I02, ADR 0014).
 *
 * The admin API writes `queued` rows into `tts_generation_jobs`; the worker
 * claims them atomically, runs synthesis and, on success, stores the audio and
 * attaches it to the DRAFT narration in the same transaction that marks the job
 * `succeeded`. Every write after the claim is conditional on the row still
 * being `running` AND still owned by the claimer's lease token, so a cancel
 * issued through the API while a job runs always wins (the worker never
 * overwrites `cancelled`), and a worker whose job was cancelled + re-queued, or
 * re-claimed after the stale window, can no longer write to that row.
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
  /**
   * Fencing token written by this claim. Every later write must present it;
   * a re-claim (stale window or cancel → re-queue → claim) replaces it.
   */
  leaseToken: string;
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
 * - `not_running`: the job left `running` (cancelled) or this claim lost its
 *   lease (re-queued/re-claimed) — nothing was written.
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
   * `running` with a fresh lease token and a cleared `errorCode`. A queued job
   * starts at `attempts = 0`; a stale re-claim KEEPS its attempts so a job that
   * keeps killing workers is dead-lettered instead of re-claimed forever.
   * Concurrent workers never claim the same row.
   */
  claimNext(): Promise<ClaimedTtsJob | null>;
  /**
   * Persist progress (attempts, errorCode, terminal `failed`) only while the
   * row is still `running` under `leaseToken`. Returns false when the job was
   * cancelled or the lease was lost.
   */
  updateRunning(record: TtsJobRecord, leaseToken: string): Promise<boolean>;
  /** See {@link TtsCompletionOutcome}. `record.status` must be `succeeded`. */
  completeWithDraftAudio(
    record: TtsJobRecord,
    attachment: DraftAudioAttachment,
    transcriptHashOf: (transcript: string) => string,
    leaseToken: string,
  ): Promise<TtsCompletionOutcome>;
  findById(id: string): Promise<TtsJobRecord | null>;
  /** Queue depth by status, for the `tts_queue_depth` gauge. */
  countByStatus(): Promise<Partial<Record<TtsJobStatus, number>>>;
}
