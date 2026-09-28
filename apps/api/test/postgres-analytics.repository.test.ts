import { describe, expect, it, vi } from 'vitest';

import { PostgresAnalyticsRepository } from '../src/analytics/postgres-analytics.repository.js';
import type { AnalyticsEventRecord } from '../src/analytics/analytics.models.js';
import type { SqlClient } from '../src/poi/postgres-poi.repository.js';

describe('PostgresAnalyticsRepository', () => {
  it('inserts a batch with conflict-safe event IDs and parameterized payloads', async () => {
    const query = vi.fn().mockResolvedValue({
      rows: [{ event_id: '20000000-0000-4000-8000-000000000001' }],
    });
    const repository = new PostgresAnalyticsRepository({
      query,
    } as unknown as SqlClient);
    const now = new Date('2026-09-25T00:00:00.000Z');
    const event: AnalyticsEventRecord = {
      eventId: '20000000-0000-4000-8000-000000000001',
      schemaVersion: 1,
      eventType: 'poi_viewed',
      occurredAt: now.toISOString(),
      payload: { poiId: '00000000-0000-4000-8000-000000000101' },
      anonymousSessionId: '10000000-0000-4000-8000-000000000001',
      receivedAt: now,
      retentionUntil: new Date('2026-10-25T00:00:00.000Z'),
      consentPolicyVersion: 'privacy-v1',
    };

    await expect(repository.insertBatch([event])).resolves.toEqual(
      new Set([event.eventId]),
    );
    const [sql, parameters] = query.mock.calls[0]!;
    expect(sql).toContain('ON CONFLICT (event_id) DO NOTHING');
    expect(sql).toContain('$6::jsonb');
    expect(parameters).toHaveLength(10);
    expect(parameters[5]).toBe(JSON.stringify(event.payload));
  });
});
