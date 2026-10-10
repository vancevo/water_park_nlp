'use client';
import type { AdminPoi, FieldCheck } from '@damsen/shared-types';
import { useCallback, useEffect, useRef, useState } from 'react';
import { fieldApi } from '@/lib/field-client';
import { flushQueue, readQueue, type QueuedCheck } from '@/lib/field-queue';

export interface FieldData {
  pois: AdminPoi[];
  checks: FieldCheck[];
  queue: QueuedCheck[];
  loading: boolean;
  error: string;
  /** Re-reads POIs and checks, after pushing anything saved offline. */
  refresh(): Promise<void>;
  /** Pushes the offline queue now; resolves how many are still waiting. */
  sync(): Promise<number>;
}

/** POIs, field checks and the offline queue for the field screens. */
export function useFieldData(): FieldData {
  const [pois, setPois] = useState<AdminPoi[]>([]);
  const [checks, setChecks] = useState<FieldCheck[]>([]);
  const [queue, setQueue] = useState<QueuedCheck[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const flushing = useRef(false);

  const sync = useCallback(async () => {
    if (flushing.current)
      return readQueue().filter((item) => !item.failure).length;
    flushing.current = true;
    try {
      const result = await flushQueue((poiId, input) =>
        fieldApi.createCheck(poiId, input),
      );
      setQueue(readQueue());
      return result.stillPending;
    } finally {
      flushing.current = false;
    }
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      await sync();
      const [nextPois, nextChecks] = await Promise.all([
        fieldApi.listPois(),
        fieldApi.listChecks(),
      ]);
      setPois(nextPois);
      setChecks(nextChecks);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Không tải được dữ liệu.',
      );
    } finally {
      setQueue(readQueue());
      setLoading(false);
    }
  }, [sync]);

  useEffect(() => {
    setQueue(readQueue());
    void refresh();
    const online = () => void sync().then(() => refresh());
    window.addEventListener('online', online);
    const timer = window.setInterval(() => void sync(), 30_000);
    return () => {
      window.removeEventListener('online', online);
      window.clearInterval(timer);
    };
  }, [refresh, sync]);

  return { pois, checks, queue, loading, error, refresh, sync };
}
