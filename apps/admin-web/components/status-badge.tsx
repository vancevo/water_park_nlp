import type { PoiStatus } from '@/lib/poi-contract';
import type { NarrationWorkflowStatus } from '@damsen/shared-types';

type ContentStatus = PoiStatus | NarrationWorkflowStatus;
const labels: Record<ContentStatus, string> = {
  draft: 'Bản nháp',
  pending_review: 'Chờ duyệt',
  published: 'Đã xuất bản',
  rejected: 'Bị từ chối',
  superseded: 'Đã thay thế',
};
export function StatusBadge({ status }: { status: ContentStatus }) {
  return <span className={`badge status-${status}`}>{labels[status]}</span>;
}
