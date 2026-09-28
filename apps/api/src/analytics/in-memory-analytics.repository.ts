import type {
  AnalyticsEventRecord,
  AnalyticsRepository,
} from './analytics.models.js';

export class InMemoryAnalyticsRepository implements AnalyticsRepository {
  readonly records = new Map<string, AnalyticsEventRecord>();

  async insertBatch(events: AnalyticsEventRecord[]): Promise<Set<string>> {
    const inserted = new Set<string>();
    for (const event of events) {
      if (this.records.has(event.eventId)) continue;
      this.records.set(event.eventId, structuredClone(event));
      inserted.add(event.eventId);
    }
    return inserted;
  }
}
