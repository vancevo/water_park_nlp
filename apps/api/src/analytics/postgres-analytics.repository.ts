import type { SqlClient } from '../poi/postgres-poi.repository.js';
import type {
  AnalyticsEventRecord,
  AnalyticsRepository,
} from './analytics.models.js';

export class PostgresAnalyticsRepository implements AnalyticsRepository {
  constructor(private readonly client: SqlClient) {}

  async insertBatch(events: AnalyticsEventRecord[]): Promise<Set<string>> {
    if (events.length === 0) return new Set();
    const parameters: unknown[] = [];
    const tuples = events.map((event, index) => {
      const offset = index * 10;
      parameters.push(
        event.eventId,
        event.schemaVersion,
        event.eventType,
        event.userId ?? null,
        event.anonymousSessionId ?? null,
        JSON.stringify(event.payload),
        event.occurredAt,
        event.receivedAt,
        event.retentionUntil,
        event.consentPolicyVersion,
      );
      return `($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4},
        $${offset + 5}, $${offset + 6}::jsonb, $${offset + 7}, $${offset + 8},
        $${offset + 9}, $${offset + 10})`;
    });
    const result = await this.client.query<{ event_id: string }>(
      `INSERT INTO analytics_events (
        event_id, schema_version, event_type, user_id, anonymous_session_id,
        payload, occurred_at, received_at, retention_until, consent_policy_version
      ) VALUES ${tuples.join(',')}
      ON CONFLICT (event_id) DO NOTHING
      RETURNING event_id`,
      parameters,
    );
    return new Set(result.rows.map((row) => row.event_id));
  }
}
