import type { AdminPoi, FieldCheck } from '@damsen/shared-types';

export type FieldPoiStatus =
  | 'unchecked' // nobody measured it yet
  | 'confirmed' // measured: where the map says
  | 'corrected' // measured: elsewhere (waiting for / after a reviewer)
  | 'problem' // reported unusable / not there
  | 'applied'; // the latest measurement was applied to the POI

export interface FieldPoiSummary {
  poi: AdminPoi;
  status: FieldPoiStatus;
  latest?: FieldCheck;
  /** Checks nobody applied yet, newest first. */
  openChecks: FieldCheck[];
}

/** Latest check wins; an applied correction counts as done. */
export function summarizePois(
  pois: readonly AdminPoi[],
  checks: readonly FieldCheck[],
): FieldPoiSummary[] {
  const byPoi = new Map<string, FieldCheck[]>();
  for (const check of checks) {
    byPoi.set(check.poiId, [...(byPoi.get(check.poiId) ?? []), check]);
  }
  return pois.map((poi) => {
    const own = (byPoi.get(poi.id) ?? []).sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
    const latest = own[0];
    const openChecks = own.filter((check) => !check.appliedAt);
    let status: FieldPoiStatus = 'unchecked';
    if (latest) {
      status =
        latest.outcome === 'problem'
          ? 'problem'
          : latest.appliedAt && latest.outcome === 'corrected'
            ? 'applied'
            : latest.outcome;
    }
    return { poi, status, ...(latest ? { latest } : {}), openChecks };
  });
}

export const FIELD_STATUS_LABEL: Record<FieldPoiStatus, string> = {
  unchecked: 'Chưa kiểm',
  confirmed: 'Đúng vị trí',
  corrected: 'Đã đo lại',
  problem: 'Có vấn đề',
  applied: 'Đã cập nhật',
};

export function progress(summaries: readonly FieldPoiSummary[]): {
  total: number;
  checked: number;
} {
  return {
    total: summaries.length,
    checked: summaries.filter((item) => item.status !== 'unchecked').length,
  };
}
