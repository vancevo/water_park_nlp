import { ConflictException, Injectable } from '@nestjs/common';

import type { TtsJobRecord, TtsJobRepository } from './tts-job.models.js';

/**
 * In-memory admin TTS job store for tests and DATABASE_URL-less runs. Mirrors
 * the uniqueness guarantees of the `tts_generation_jobs` table: one row per
 * idempotency key.
 */
@Injectable()
export class InMemoryTtsJobRepository implements TtsJobRepository {
  private readonly byId = new Map<string, TtsJobRecord>();
  private readonly idByKey = new Map<string, string>();

  constructor(seed: readonly TtsJobRecord[] = []) {
    for (const record of seed) {
      this.byId.set(record.id, structuredClone(record));
      this.idByKey.set(record.idempotencyKey, record.id);
    }
  }

  async findById(id: string): Promise<TtsJobRecord | null> {
    return this.clone(this.byId.get(id));
  }

  async findByIdempotencyKey(key: string): Promise<TtsJobRecord | null> {
    const id = this.idByKey.get(key);
    return id ? this.clone(this.byId.get(id)) : null;
  }

  async insert(record: TtsJobRecord): Promise<void> {
    if (this.idByKey.has(record.idempotencyKey)) {
      throw new ConflictException('A TTS job already exists for this request');
    }
    this.byId.set(record.id, structuredClone(record));
    this.idByKey.set(record.idempotencyKey, record.id);
  }

  async save(record: TtsJobRecord): Promise<void> {
    this.byId.set(record.id, structuredClone(record));
    this.idByKey.set(record.idempotencyKey, record.id);
  }

  private clone(record: TtsJobRecord | undefined): TtsJobRecord | null {
    return record ? structuredClone(record) : null;
  }
}
