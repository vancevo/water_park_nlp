import type {
  GeoPoint,
  LoyaltyLedgerEntry,
  RealtimeEvent,
} from '@damsen/shared-types';

export const GATE_1_POINT: GeoPoint = {
  latitude: 10.7658059,
  longitude: 106.6416272,
};

function hash(value: string): number {
  let result = 2166136261;
  for (const character of value) {
    result ^= character.charCodeAt(0);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

/**
 * Put demo visitors in a small deterministic ring around Gate 1. The offset is
 * only for visual separation; it is not presented as a real GPS measurement.
 */
export function simulatedGatePoint(identity: string): GeoPoint {
  const seed = hash(identity);
  const angle = ((seed % 3600) / 3600) * Math.PI * 2;
  const radiusMeters = 6 + ((seed >>> 12) % 1200) / 100;
  const latitudeRadians = (GATE_1_POINT.latitude * Math.PI) / 180;
  return {
    latitude:
      GATE_1_POINT.latitude + (Math.sin(angle) * radiusMeters) / 111_320,
    longitude:
      GATE_1_POINT.longitude +
      (Math.cos(angle) * radiusMeters) / (111_320 * Math.cos(latitudeRadians)),
  };
}

export function paidOrderId(event: RealtimeEvent): string | null {
  if (event.type !== 'loyalty.balance_changed.v1') return null;
  if (!event.payload || typeof event.payload !== 'object') return null;
  const payload = event.payload as { orderId?: unknown; delta?: unknown };
  return typeof payload.orderId === 'string' &&
    typeof payload.delta === 'number' &&
    payload.delta > 0
    ? payload.orderId
    : null;
}

const VIETNAM_OFFSET_MS = 7 * 60 * 60 * 1_000;

function vietnamDay(value: Date): string {
  return new Date(value.getTime() + VIETNAM_OFFSET_MS)
    .toISOString()
    .slice(0, 10);
}

export function paidLedgerEntryIdToday(
  entries: LoyaltyLedgerEntry[],
  now = new Date(),
): string | null {
  const today = vietnamDay(now);
  return (
    entries.find((entry) => {
      if (entry.entryType !== 'payment_credit') return false;
      const createdAt = new Date(entry.createdAt);
      return (
        !Number.isNaN(createdAt.getTime()) && vietnamDay(createdAt) === today
      );
    })?.id ?? null
  );
}
