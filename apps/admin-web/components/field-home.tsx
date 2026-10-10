'use client';
import Link from 'next/link';
import { useMemo, useState } from 'react';
import { useFieldData } from '@/hooks/use-field-data';
import { useWatchPosition } from '@/hooks/use-watch-position';
import { describeOffset } from '@/lib/geo-math';
import { distanceMeters } from '@/lib/walk-nodes';
import { gpsQuality } from '@/lib/gps-sampler';
import {
  FIELD_STATUS_LABEL,
  progress,
  summarizePois,
  type FieldPoiStatus,
} from '@/lib/field-status';
import { POI_CATEGORIES } from '@/lib/poi-categories';
import { FieldShell } from './field-shell';

type Filter = 'todo' | 'done' | 'problem' | 'all';
const FILTERS: { id: Filter; label: string }[] = [
  { id: 'todo', label: 'Chưa kiểm' },
  { id: 'done', label: 'Đã kiểm' },
  { id: 'problem', label: 'Cần chú ý' },
  { id: 'all', label: 'Tất cả' },
];

const matches = (filter: Filter, status: FieldPoiStatus) =>
  filter === 'all' ||
  (filter === 'todo' && status === 'unchecked') ||
  (filter === 'done' &&
    ['confirmed', 'applied', 'corrected'].includes(status)) ||
  (filter === 'problem' && ['problem', 'corrected'].includes(status));

export function FieldHome() {
  const data = useFieldData();
  const { fix, error: gpsError } = useWatchPosition();
  const [filter, setFilter] = useState<Filter>('todo');
  const [query, setQuery] = useState('');

  const summaries = useMemo(
    () => summarizePois(data.pois, data.checks),
    [data.pois, data.checks],
  );
  const done = progress(summaries);
  const waiting = data.queue.filter((item) => !item.failure).length;
  const refused = data.queue.filter((item) => item.failure).length;

  const rows = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return summaries
      .filter((item) => matches(filter, item.status))
      .filter(
        (item) =>
          !needle ||
          item.poi.translations.some((t) =>
            t.name.toLocaleLowerCase().includes(needle),
          ) ||
          item.poi.slug.includes(needle),
      )
      .map((item) => ({
        ...item,
        away: fix
          ? distanceMeters(fix, {
              latitude: item.poi.location.latitude,
              longitude: item.poi.location.longitude,
            })
          : undefined,
      }))
      .sort(
        (a, b) =>
          (a.away ?? Number.MAX_SAFE_INTEGER) -
            (b.away ?? Number.MAX_SAFE_INTEGER) ||
          a.poi.slug.localeCompare(b.poi.slug),
      );
  }, [summaries, filter, query, fix]);

  return (
    <FieldShell
      title="Xác minh vị trí"
      actions={
        <span className="field-links">
          <Link href="/field/new" className="field-link">
            ＋ Thêm địa điểm tại đây
          </Link>
          <Link href="/field/review" className="field-link">
            Duyệt kết quả đo
          </Link>
        </span>
      }
    >
      <section className="field-status" aria-label="Trạng thái">
        <div className="field-progress">
          <b>
            {done.checked}/{done.total}
          </b>{' '}
          địa điểm đã kiểm
          <div className="field-bar">
            <span
              style={{
                width: `${done.total ? (done.checked / done.total) * 100 : 0}%`,
              }}
            />
          </div>
        </div>
        <div
          className={`field-gps ${fix ? gpsQuality(fix.accuracyMeters) : 'none'}`}
          role="status"
        >
          {fix
            ? `GPS ±${Math.round(fix.accuracyMeters)} m`
            : gpsError || 'Đang chờ GPS…'}
        </div>
        {(waiting > 0 || refused > 0) && (
          <div className="field-sync" role="status">
            {waiting > 0 && <span>⏳ {waiting} kết quả chờ gửi</span>}
            {refused > 0 && (
              <span className="field-error"> · {refused} bị từ chối</span>
            )}
            <button
              className="button ghost small"
              onClick={() => void data.sync().then(data.refresh)}
            >
              Gửi ngay
            </button>
          </div>
        )}
      </section>
      <div className="field-filters" role="group" aria-label="Lọc">
        {FILTERS.map((item) => (
          <button
            key={item.id}
            className={filter === item.id ? 'selected' : ''}
            onClick={() => setFilter(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>
      <input
        className="field-search"
        placeholder="Tìm tên địa điểm…"
        aria-label="Tìm địa điểm"
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      {data.error && (
        <div className="alert error" role="alert">
          {data.error}{' '}
          <button
            className="button ghost small"
            onClick={() => void data.refresh()}
          >
            Thử lại
          </button>
        </div>
      )}
      {data.loading && summaries.length === 0 ? (
        <p className="helper">Đang tải…</p>
      ) : (
        <ul className="field-list">
          {rows.map(({ poi, status, away }) => {
            const name =
              poi.translations.find((t) => t.locale === 'vi')?.name ?? poi.slug;
            const category =
              POI_CATEGORIES.find((c) => c.slug === poi.category)?.label ??
              poi.category;
            return (
              <li key={poi.id}>
                <Link href={`/field/${poi.id}`} className="field-row">
                  <span className="field-row-main">
                    <b>{name}</b>
                    <small>
                      {category}
                      {poi.status !== 'published' ? ` · ${poi.status}` : ''}
                    </small>
                  </span>
                  <span className="field-row-side">
                    <span className={`chip ${status}`}>
                      {FIELD_STATUS_LABEL[status]}
                    </span>
                    {fix && away !== undefined && (
                      <small>
                        {describeOffset(fix, {
                          latitude: poi.location.latitude,
                          longitude: poi.location.longitude,
                        })}
                      </small>
                    )}
                  </span>
                </Link>
              </li>
            );
          })}
          {rows.length === 0 && (
            <li className="helper">Không có địa điểm nào trong mục này.</li>
          )}
        </ul>
      )}
    </FieldShell>
  );
}
