import { Injectable } from '@nestjs/common';

import type {
  FieldCheckQuery,
  FieldCheckRecord,
  FieldCheckRepository,
} from './field-check.models.js';

@Injectable()
export class InMemoryFieldCheckRepository implements FieldCheckRepository {
  private readonly rows: FieldCheckRecord[] = [];

  async create(
    record: FieldCheckRecord,
  ): Promise<{ record: FieldCheckRecord; created: boolean }> {
    const existing = this.rows.find((row) => row.clientId === record.clientId);
    if (existing) return { record: structuredClone(existing), created: false };
    this.rows.push(structuredClone(record));
    return { record: structuredClone(record), created: true };
  }

  async find(id: string): Promise<FieldCheckRecord | null> {
    const row = this.rows.find((item) => item.id === id);
    return row ? structuredClone(row) : null;
  }

  async list(query: FieldCheckQuery): Promise<FieldCheckRecord[]> {
    return this.rows
      .filter((row) => !query.poiId || row.poiId === query.poiId)
      .filter((row) => !query.unappliedOnly || !row.appliedAt)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, query.limit)
      .map((row) => structuredClone(row));
  }

  async markApplied(
    id: string,
    appliedBy: string,
    appliedAt: Date,
  ): Promise<void> {
    const row = this.rows.find((item) => item.id === id);
    if (row) {
      row.appliedBy = appliedBy;
      row.appliedAt = appliedAt;
    }
  }
}
