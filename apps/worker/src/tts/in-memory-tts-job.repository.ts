import type { TtsJobRecord, TtsJobRepository } from './types.js';

/** In-memory job store for tests and local runs. */
export class InMemoryTtsJobRepository implements TtsJobRepository {
  private readonly byId = new Map<string, TtsJobRecord>();
  private readonly idByKey = new Map<string, string>();

  constructor(seed: readonly TtsJobRecord[] = []) {
    for (const record of seed) this.write(record);
  }

  async findByIdempotencyKey(key: string): Promise<TtsJobRecord | null> {
    const id = this.idByKey.get(key);
    return id ? this.clone(this.byId.get(id)) : null;
  }

  async findById(id: string): Promise<TtsJobRecord | null> {
    return this.clone(this.byId.get(id));
  }

  async save(record: TtsJobRecord): Promise<void> {
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
