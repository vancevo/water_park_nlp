import type { PoiDetail } from './model';

export type PoiDetailState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; detail: PoiDetail };

interface DetailQuerySnapshot {
  detailed: boolean;
  isPending: boolean;
  isError: boolean;
  data?: PoiDetail;
}

export function resolvePoiDetailState({
  detailed,
  isPending,
  isError,
  data,
}: DetailQuerySnapshot): PoiDetailState {
  if (!detailed) return { status: 'idle' };
  if (isError) return { status: 'error' };
  if (isPending || !data) return { status: 'loading' };
  return { status: 'ready', detail: data };
}
