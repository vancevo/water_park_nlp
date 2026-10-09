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
 * `running`, and completion attaches audio to a draft narration atomically.
 */
export class InMemoryTtsJobQueue implements TtsJobQueue {
  private readonly jobs = new Map<string, TtsJobRecord>();
  private readonly narrations = new Map<string, TtsNarrationSnapshot>();
  private readonly audio = new Map<string, DraftAudioAttachment>();

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

  async claimNext(): Promise<ClaimedTtsJob | null> {
    const queued = [...this.jobs.values()]
      .filter((job) => job.status === 'queued')
      .sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime());
    for (const job of queued) {
      const narration = this.narrations.get(job.narrationId);
      if (!narration) continue;
      job.status = 'running';
      job.attempts = 0;
      job.errorCode = null;
      job.deadLettered = false;
      job.updatedAt = this.clock();
      return { job: structuredClone(job), narration: { ...narration } };
    }
    return null;
  }

  async updateRunning(record: TtsJobRecord): Promise<boolean> {
    const current = this.jobs.get(record.id);
    if (!current || current.status !== 'running') return false;
    this.jobs.set(record.id, structuredClone({ ...record, artifact: null }));
    return true;
  }

  async completeWithDraftAudio(
    record: TtsJobRecord,
    attachment: DraftAudioAttachment,
    transcriptHashOf: (transcript: string) => string,
  ): Promise<TtsCompletionOutcome> {
    const current = this.jobs.get(record.id);
    if (!current || current.status !== 'running') return 'not_running';
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
