import type { AdminPoi } from '@damsen/shared-types';

export type ReviewTab = 'pending_review' | 'draft' | 'rejected';

export const REVIEW_TABS: { id: ReviewTab; label: string }[] = [
  { id: 'pending_review', label: 'Chờ duyệt' },
  { id: 'draft', label: 'Bản nháp' },
  { id: 'rejected', label: 'Bị từ chối' },
];

export function countByTab(
  pois: readonly AdminPoi[],
): Record<ReviewTab, number> {
  return {
    pending_review: pois.filter((poi) => poi.status === 'pending_review')
      .length,
    draft: pois.filter((poi) => poi.status === 'draft').length,
    rejected: pois.filter((poi) => poi.status === 'rejected').length,
  };
}

/** Why a place cannot be submitted yet (mirrors the API's publish rules). */
export function missingForSubmit(poi: AdminPoi): string[] {
  const missing: string[] = [];
  const has = (locale: string) =>
    poi.translations.some((item) => item.locale === locale && item.name.trim());
  if (!has('vi')) missing.push('thiếu tên tiếng Việt');
  if (!has('en')) missing.push('thiếu tên tiếng Anh');
  const primaries = poi.entrances.filter(
    (entrance) => entrance.isPrimary,
  ).length;
  if (primaries !== 1) missing.push('cần đúng một cổng chính');
  return missing;
}
