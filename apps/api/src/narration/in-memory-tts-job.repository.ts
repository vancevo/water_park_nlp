import { ConflictException, Injectable } from '@nestjs/common';

import type { TtsJobRecord, TtsJobRepository } from './tts-job.models.js';

/**
 * In-memory admin TTS job store for tests and DATABASE_URL-less runs. Mirrors
 * the guarantees of the `tts_generation_jobs` table: one row per idempotency
 * key, and conditional requeue/cancel transitions.
 */
@Injectable()
export class InMemoryTtsJobRepository implements TtsJobRepository {
  private readonly byId = new Map<string, TtsJobRecord>();
  private readonly idByKey = new Map<string, string>();

  constructor(seed: readonly TtsJobRecord[] = []) {
    for (const record of seed) this.write(record);
  }

  async findById(id: string): Promise<TtsJobRecord | null> {
    return this.clone(this.byId.get(id));
  }

  async findByIdempotencyKey(key: string): Promise<TtsJobRecord | null> {
    const id = this.idByKey.get(key);
    return id ? this.clone(this.byId.get(id)) : null;
  }

  async findLatestByNarration(
    narrationId: string,
  ): Promise<TtsJobRecord | null> {
    const latest = [...this.byId.values()]
      .filter((job) => job.narrationId === narrationId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
    return this.clone(latest);
  }

  async hasActiveForNarration(narrationId: string): Promise<boolean> {
    return [...this.byId.values()].some(
      (job) =>
        job.narrationId === narrationId &&
        (job.status === 'queued' || job.status === 'running'),
    );
  }

  async countActive(): Promise<number> {
    return [...this.byId.values()].filter(
      (job) => job.status === 'queued' || job.status === 'running',
    ).length;
  }

  async insert(record: TtsJobRecord): Promise<void> {
    if (this.idByKey.has(record.idempotencyKey)) {
      throw new ConflictException('A TTS job already exists for this request');
    }
    this.write(record);
  }

  async requeue(record: TtsJobRecord): Promise<boolean> {
    const current = this.byId.get(record.id);
    if (
      !current ||
      !['failed', 'cancelled', 'succeeded'].includes(current.status)
    )
      return false;
    this.write({ ...record, artifact: null });
    return true;
  }

  async cancelIfActive(id: string, at: Date): Promise<TtsJobRecord | null> {
    const current = this.byId.get(id);
    if (!current || !['queued', 'running'].includes(current.status))
      return null;
    current.status = 'cancelled';
    current.updatedAt = at;
    return this.clone(current);
  }

  /** Test helper: what the worker writes (claim/progress/result). */
  async workerWrite(record: TtsJobRecord): Promise<void> {
    this.write(record);
  }

  private write(record: TtsJobRecord): void {
    this.byId.set(record.id, structuredClone(record));
    this.idByKey.set(record.idempotencyKey, record.id);
  }

  private clone(record: TtsJobRecord | undefined): TtsJobRecord | null {
    return record ? structuredClone(record) : null;
  }
}
