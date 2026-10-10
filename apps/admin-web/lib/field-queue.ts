import type { FieldCheckInput } from '@damsen/shared-types';

/** A check waiting to reach the server (weak signal in the park is normal). */
export interface QueuedCheck {
  poiId: string;
  input: FieldCheckInput;
  savedAt: string;
  /** Set when the server refused it for good (not a network problem). */
  failure?: string;
}

type StorageLike = Pick<Storage, 'getItem' | 'setItem'>;
const KEY = 'damsen.admin.fieldQueue.v1';

function storageOrNull(storage?: StorageLike | null): StorageLike | null {
  if (storage !== undefined) return storage;
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function readQueue(storage?: StorageLike | null): QueuedCheck[] {
  try {
    const raw = storageOrNull(storage)?.getItem(KEY);
    return raw ? (JSON.parse(raw) as QueuedCheck[]) : [];
  } catch {
    return [];
  }
}

function writeQueue(items: QueuedCheck[], storage?: StorageLike | null): void {
  try {
    storageOrNull(storage)?.setItem(KEY, JSON.stringify(items));
  } catch {
    // Blocked/full storage: the in-memory state still shows it until reload.
  }
}

export function enqueueCheck(
  poiId: string,
  input: FieldCheckInput,
  storage?: StorageLike | null,
  now: () => Date = () => new Date(),
): QueuedCheck[] {
  const next = [
    ...readQueue(storage).filter(
      (item) => item.input.clientId !== input.clientId,
    ),
    { poiId, input, savedAt: now().toISOString() },
  ];
  writeQueue(next, storage);
  return next;
}

export function dismissQueued(
  clientId: string,
  storage?: StorageLike | null,
): QueuedCheck[] {
  const next = readQueue(storage).filter(
    (item) => item.input.clientId !== clientId,
  );
  writeQueue(next, storage);
  return next;
}

export interface FlushResult {
  sent: number;
  stillPending: number;
  refused: number;
}

/** A refusal that retrying cannot fix (bad data, unknown POI, conflicting clientId...). */
function isPermanent(error: unknown): boolean {
  const status =
    typeof error === 'object' && error !== null && 'status' in error
      ? Number((error as { status: unknown }).status)
      : 0;
  return (
    status >= 400 &&
    status < 500 &&
    status !== 401 &&
    status !== 408 &&
    status !== 429
  );
}

function reasonOf(error: unknown): string {
  return error instanceof Error ? error.message : 'Bị từ chối';
}

/**
 * Uploads queued checks one by one, oldest first. Network errors, 5xx and 401 keep the
 * item for later; a 4xx refusal marks it `failure` so it stops retrying but is not lost.
 * The server dedupes by `clientId`, so a retry after a lost response is safe.
 */
export async function flushQueue(
  send: (poiId: string, input: FieldCheckInput) => Promise<unknown>,
  storage?: StorageLike | null,
): Promise<FlushResult> {
  let sent = 0;
  let refused = 0;
  const kept: QueuedCheck[] = [];
  const items = readQueue(storage);
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]!;
    if (item.failure) {
      kept.push(item);
      refused += 1;
      continue;
    }
    try {
      await send(item.poiId, item.input);
      sent += 1;
    } catch (error) {
      if (isPermanent(error)) {
        kept.push({ ...item, failure: reasonOf(error) });
        refused += 1;
      } else {
        kept.push(item, ...items.slice(index + 1)); // offline: stop, keep the order
        break;
      }
    }
  }
  writeQueue(kept, storage);
  return {
    sent,
    refused,
    stillPending: kept.filter((item) => !item.failure).length,
  };
}
