import { randomUUID } from 'node:crypto';

import type {
  ClaimedTtsJob,
  DraftAudioAttachment,
  TtsCompletionOutcome,
  TtsJobQueue,
  TtsNarrationSnapshot,
} from './tts-job-queue.js';
import type { TtsJobRecord, TtsJobStatus } from './types.js';

/**
 * In-memory {@link TtsJobQueue} for tests and local runs. Mirrors the Postgres
 * semantics: claim is exclusive, writes after the claim are conditional on
 * `running` + the claim's lease token, and completion attaches audio to a
 * draft narration atomically. (No stale-window re-claim: see
 * {@link reclaimStale} for tests.)
 */
export class InMemoryTtsJobQueue implements TtsJobQueue {
  private readonly jobs = new Map<string, TtsJobRecord>();
  private readonly narrations = new Map<string, TtsNarrationSnapshot>();
  private readonly audio = new Map<string, DraftAudioAttachment>();
  private readonly leases = new Map<string, string>();

  constructor(
    seed: { jobs?: TtsJobRecord[]; narrations?: TtsNarrationSnapshot[] } = {},
    private readonly clock: () => Date = () => new Date(),
  ) {
    for (const job of seed.jobs ?? [])
      this.jobs.set(job.id, structuredClone(job));
    for (const narration of seed.narrations ?? [])
      this.narrations.set(narration.id, { ...narration });
  }

  /** Test/API-side helpers. */
  enqueue(job: TtsJobRecord): void {
    this.jobs.set(job.id, structuredClone(job));
  }

  cancel(id: string): void {
    const job = this.jobs.get(id);
    if (job && (job.status === 'queued' || job.status === 'running')) {
      job.status = 'cancelled';
      job.updatedAt = this.clock();
    }
  }

  setNarration(narration: TtsNarrationSnapshot): void {
    this.narrations.set(narration.id, { ...narration });
  }

  attachedAudio(narrationId: string): DraftAudioAttachment | null {
    return this.audio.get(narrationId) ?? null;
  }

  /** Test helper: re-claim a `running` job as if its lease went stale. */
  reclaimStale(id: string): ClaimedTtsJob | null {
    const job = this.jobs.get(id);
    const narration = job && this.narrations.get(job.narrationId);
    if (!job || job.status !== 'running' || !narration) return null;
    return this.claim(job, narration, true);
  }

  async claimNext(): Promise<ClaimedTtsJob | null> {
    const queued = [...this.jobs.values()]
      .filter((job) => job.status === 'queued')
      .sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime());
    for (const job of queued) {
      const narration = this.narrations.get(job.narrationId);
      if (!narration) continue;
      return this.claim(job, narration, false);
    }
    return null;
  }

  private claim(
    job: TtsJobRecord,
    narration: TtsNarrationSnapshot,
    stale: boolean,
  ): ClaimedTtsJob {
    const leaseToken = randomUUID();
    job.status = 'running';
    if (!stale) job.attempts = 0;
    job.errorCode = null;
    job.deadLettered = false;
    job.updatedAt = this.clock();
    this.leases.set(job.id, leaseToken);
    return {
      job: structuredClone(job),
      narration: { ...narration },
      leaseToken,
    };
  }

  private owns(id: string, leaseToken: string): boolean {
    const current = this.jobs.get(id);
    return current?.status === 'running' && this.leases.get(id) === leaseToken;
  }

  async updateRunning(
    record: TtsJobRecord,
    leaseToken: string,
  ): Promise<boolean> {
    if (!this.owns(record.id, leaseToken)) return false;
    this.jobs.set(record.id, structuredClone({ ...record, artifact: null }));
    return true;
  }

  async completeWithDraftAudio(
    record: TtsJobRecord,
    attachment: DraftAudioAttachment,
    transcriptHashOf: (transcript: string) => string,
    leaseToken: string,
  ): Promise<TtsCompletionOutcome> {
    if (!this.owns(record.id, leaseToken)) return 'not_running';
    const narration = this.narrations.get(record.narrationId);
    if (!narration || narration.status !== 'draft')
      return 'narration_not_draft';
    if (transcriptHashOf(narration.transcript) !== record.transcriptHash)
      return 'transcript_changed';
    this.jobs.set(record.id, structuredClone(record));
    this.audio.set(record.narrationId, structuredClone(attachment));
    return 'succeeded';
  }

  async findById(id: string): Promise<TtsJobRecord | null> {
    const job = this.jobs.get(id);
    return job ? structuredClone(job) : null;
  }

  async countByStatus(): Promise<Partial<Record<TtsJobStatus, number>>> {
    const counts: Partial<Record<TtsJobStatus, number>> = {};
    for (const job of this.jobs.values())
      counts[job.status] = (counts[job.status] ?? 0) + 1;
    return counts;
  }
}
