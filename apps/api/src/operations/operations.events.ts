import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import type { RealtimeEvent } from '@damsen/shared-types';

export interface OperationsNotice {
  type:
    | 'payment.status.v1'
    | 'loyalty.balance_changed.v1'
    | 'dashboard.delta.v1'
    | 'presence.delta.v1'
    | 'visitor.presence.delta.v1';
  userId?: string;
  orderId?: string;
  payload: unknown;
  eventId?: string;
  occurredAt?: string;
}

export interface OperationsRealtimeNotice {
  event: RealtimeEvent;
  userId?: string;
  orderId?: string;
}

@Injectable()
export class OperationsEvents {
  private readonly emitter = new EventEmitter();
  private readonly sequences = new Map<string, number>();

  publish(notice: OperationsNotice): void {
    const aggregate = notice.orderId ?? notice.userId ?? 'operations';
    const sequenceKey = `${notice.type}:${aggregate}`;
    const sequence = (this.sequences.get(sequenceKey) ?? 0) + 1;
    this.sequences.set(sequenceKey, sequence);
    this.emitter.emit('notice', {
      event: {
        eventId: notice.eventId ?? randomUUID(),
        schemaVersion: 1,
        sequence,
        occurredAt: notice.occurredAt ?? new Date().toISOString(),
        type: notice.type,
        payload: notice.payload,
      },
      ...(notice.userId ? { userId: notice.userId } : {}),
      ...(notice.orderId ? { orderId: notice.orderId } : {}),
    } satisfies OperationsRealtimeNotice);
  }

  subscribe(listener: (notice: OperationsRealtimeNotice) => void): () => void {
    this.emitter.on('notice', listener);
    return () => this.emitter.off('notice', listener);
  }
}
