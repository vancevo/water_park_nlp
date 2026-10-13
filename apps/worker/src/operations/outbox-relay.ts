interface OutboxRow {
  id: string;
  event_type: string;
  aggregate_id: string;
  payload: Record<string, unknown>;
  created_at: Date | string;
  retry_count: number;
}

export interface OutboxDatabase {
  query<T extends object = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: T[] }>;
}

export interface OutboxRealtimePublisher {
  nextSequence(stream: string): Promise<number>;
  emit(room: string, eventType: string, event: unknown): void;
}

const EVENT_TYPES = new Set([
  'payment.status.v1',
  'loyalty.balance_changed.v1',
]);

export class OperationsOutboxRelay {
  constructor(
    private readonly database: OutboxDatabase,
    private readonly realtime: OutboxRealtimePublisher,
  ) {}

  async drain(): Promise<{ published: number; failed: number }> {
    const result = await this.database.query<OutboxRow>(
      `SELECT id, event_type, aggregate_id, payload, created_at, retry_count
       FROM domain_outbox
       WHERE published_at IS NULL
         AND dead_lettered_at IS NULL
         AND next_attempt_at <= now()
       ORDER BY created_at
       LIMIT 50`,
    );
    let published = 0;
    let failed = 0;
    for (const row of result.rows) {
      try {
        await this.publish(row);
        published += 1;
      } catch {
        await this.fail(row);
        failed += 1;
      }
    }
    return { published, failed };
  }

  private async publish(row: OutboxRow): Promise<void> {
    if (!EVENT_TYPES.has(row.event_type)) throw new Error('UNSUPPORTED_EVENT');
    const stream = `${row.event_type}:${row.aggregate_id}`;
    const event = {
      eventId: row.id,
      schemaVersion: 1,
      sequence: await this.realtime.nextSequence(stream),
      occurredAt: new Date(row.created_at).toISOString(),
      type: row.event_type,
      payload: row.payload,
    };
    if (row.event_type === 'payment.status.v1') {
      this.realtime.emit(`order:${row.aggregate_id}`, row.event_type, event);
      if (typeof row.payload.userId === 'string') {
        this.realtime.emit(`user:${row.payload.userId}`, row.event_type, event);
      }
    } else {
      this.realtime.emit(`user:${row.aggregate_id}`, row.event_type, event);
    }
    await this.database.query(
      `UPDATE domain_outbox SET published_at = now(), last_error_code = NULL
       WHERE id = $1 AND published_at IS NULL`,
      [row.id],
    );
  }

  private async fail(row: OutboxRow): Promise<void> {
    const deadLetter = row.retry_count >= 9;
    await this.database.query(
      `UPDATE domain_outbox
       SET retry_count = retry_count + 1,
           last_error_code = 'RELAY_PUBLISH_FAILED',
           next_attempt_at = now() + make_interval(secs => LEAST(60, power(2, retry_count)::int)),
           dead_lettered_at = CASE WHEN $2 THEN now() ELSE dead_lettered_at END
       WHERE id = $1 AND published_at IS NULL`,
      [row.id, deadLetter],
    );
  }
}
