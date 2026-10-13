import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';

import { createPgPool } from '../common/pg-pool.js';
import {
  OperationsEvents,
  type OperationsNotice,
} from '../operations/operations.events.js';

interface OutboxRow extends Record<string, unknown> {
  id: string;
  event_type: OperationsNotice['type'];
  aggregate_id: string;
  payload: Record<string, unknown>;
  created_at: Date | string;
  retry_count: number;
}

interface OutboxPool {
  query<T extends Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<{ rows: T[] }>;
  end(): Promise<void>;
}

const EVENT_TYPES = new Set<OperationsNotice['type']>([
  'payment.status.v1',
  'loyalty.balance_changed.v1',
]);

@Injectable()
export class OutboxRelayService implements OnModuleInit, OnModuleDestroy {
  private readonly pool?: OutboxPool;
  private timer?: NodeJS.Timeout;
  private draining = false;
  private published = 0;
  private failed = 0;
  private deadLettered = 0;

  constructor(private readonly events: OperationsEvents) {
    if (
      process.env.DATABASE_URL &&
      process.env.OPERATIONS_OUTBOX_RELAY_ENABLED !== 'false'
    ) {
      this.pool = createPgPool<OutboxPool>(
        process.env.DATABASE_URL,
        'outbox-relay',
      );
    }
  }

  onModuleInit(): void {
    if (!this.pool) return;
    this.timer = setInterval(() => void this.drain(), 1_000);
    this.timer.unref();
    void this.drain();
  }

  async onModuleDestroy(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    await this.pool?.end();
  }

  metrics() {
    return {
      published: this.published,
      failed: this.failed,
      deadLettered: this.deadLettered,
    };
  }

  async drain(): Promise<void> {
    if (!this.pool || this.draining) return;
    this.draining = true;
    try {
      const result = await this.pool.query<OutboxRow>(
        `SELECT id, event_type, aggregate_id, payload, created_at, retry_count
         FROM domain_outbox
         WHERE published_at IS NULL
           AND dead_lettered_at IS NULL
           AND next_attempt_at <= now()
         ORDER BY created_at
         LIMIT 50`,
      );
      for (const row of result.rows) await this.publish(row);
    } catch {
      this.failed += 1;
    } finally {
      this.draining = false;
    }
  }

  private async publish(row: OutboxRow): Promise<void> {
    try {
      if (!EVENT_TYPES.has(row.event_type))
        throw new Error('UNSUPPORTED_EVENT');
      const userId =
        row.event_type === 'loyalty.balance_changed.v1'
          ? row.aggregate_id
          : typeof row.payload.userId === 'string'
            ? row.payload.userId
            : undefined;
      this.events.publish({
        type: row.event_type,
        eventId: row.id,
        occurredAt: new Date(row.created_at).toISOString(),
        ...(row.event_type === 'payment.status.v1'
          ? { orderId: row.aggregate_id }
          : {}),
        ...(userId ? { userId } : {}),
        payload: row.payload,
      });
      await this.pool!.query(
        `UPDATE domain_outbox SET published_at = now(), last_error_code = NULL
         WHERE id = $1 AND published_at IS NULL`,
        [row.id],
      );
      this.published += 1;
    } catch {
      const deadLetter = row.retry_count >= 9;
      await this.pool!.query(
        `UPDATE domain_outbox
         SET retry_count = retry_count + 1,
             last_error_code = 'RELAY_PUBLISH_FAILED',
             next_attempt_at = now() + make_interval(secs => LEAST(60, power(2, retry_count)::int)),
             dead_lettered_at = CASE WHEN $2 THEN now() ELSE dead_lettered_at END
         WHERE id = $1 AND published_at IS NULL`,
        [row.id, deadLetter],
      );
      this.failed += 1;
      if (deadLetter) this.deadLettered += 1;
    }
  }
}
