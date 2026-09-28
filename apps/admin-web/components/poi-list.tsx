'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { getPoiClient } from '@/lib/api-poi-client';
import type { Poi, PoiStatus } from '@/lib/poi-contract';
import { StatusBadge } from './status-badge';

const clientPromise = getPoiClient();

export function PoiList() {
  const [items, setItems] = useState<Poi[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<PoiStatus | 'all'>('all');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const client = await clientPromise;
      setItems(await client.list({ search, status }));
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : 'Không thể tải danh sách POI.',
      );
    } finally {
      setLoading(false);
    }
  }, [search, status]);

  useEffect(() => {
    const timer = window.setTimeout(load, 250);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function remove(item: Poi) {
    if (
      !window.confirm(
        `Xóa “${item.translations.find((t) => t.locale === 'vi')?.name ?? item.id}”?`,
      )
    )
      return;
    const snapshot = items;
    setItems((current) => current.filter((poi) => poi.id !== item.id));
    try {
      const client = await clientPromise;
      await client.remove(item.id);
    } catch (reason) {
      setItems(snapshot);
      setError(
        `${reason instanceof Error ? reason.message : 'Xóa thất bại.'} Danh sách đã được khôi phục.`,
      );
    }
  }

  return (
    <section>
      <div className="title-row">
        <div>
          <p className="eyebrow">NỘI DUNG KHÁM PHÁ</p>
          <h1>Điểm tham quan</h1>
          <p>Quản lý vị trí, cổng dẫn đường và thuyết minh đa ngôn ngữ.</p>
        </div>
        <Link className="button primary" href="/pois/new">
          + Thêm POI
        </Link>
      </div>
      <div className="toolbar">
        <label className="search">
          <span>⌕</span>
          <input
            aria-label="Tìm POI"
            placeholder="Tìm theo tên…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <select
          aria-label="Lọc trạng thái"
          value={status}
          onChange={(e) => setStatus(e.target.value as PoiStatus | 'all')}
        >
          <option value="all">Tất cả trạng thái</option>
          <option value="draft">Bản nháp</option>
          <option value="pending_review">Chờ duyệt</option>
          <option value="published">Đã xuất bản</option>
          <option value="rejected">Bị từ chối</option>
        </select>
        <button className="button ghost" onClick={load}>
          Làm mới
        </button>
      </div>
      {error && (
        <div className="alert error" role="alert">
          <span>{error}</span>
          <button onClick={load}>Thử lại</button>
        </div>
      )}
      {loading ? (
        <div className="panel state" aria-live="polite">
          <div className="spinner" />
          Đang tải POI…
        </div>
      ) : items.length === 0 ? (
        <div className="panel state">
          <b>Chưa có POI phù hợp</b>
          <p>Đổi bộ lọc hoặc tạo điểm khám phá đầu tiên.</p>
          <Link className="button primary" href="/pois/new">
            Tạo POI
          </Link>
        </div>
      ) : (
        <div className="panel table-wrap">
          <table>
            <thead>
              <tr>
                <th>Điểm khám phá</th>
                <th>Danh mục</th>
                <th>Trạng thái</th>
                <th>Bản dịch</th>
                <th>Phiên bản chờ</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {items.map((poi) => {
                const vi = poi.translations.find((t) => t.locale === 'vi');
                const locales = poi.translations
                  .filter((t) => t.name.trim())
                  .map((t) => t.locale.toUpperCase());
                return (
                  <tr key={poi.id}>
                    <td>
                      <strong>{vi?.name || 'Chưa có tên tiếng Việt'}</strong>
                      <small>
                        {poi.slug} • {poi.entrances.length} cổng
                      </small>
                    </td>
                    <td>{poi.category}</td>
                    <td>
                      <StatusBadge status={poi.status} />
                    </td>
                    <td>
                      <span className={locales.length < 2 ? 'missing' : ''}>
                        {locales.join(' · ') || 'Thiếu'}
                      </span>
                    </td>
                    <td>{poi.pendingVersionId ? 'Có bản chờ duyệt' : '—'}</td>
                    <td className="actions">
                      <Link href={`/pois/${poi.id}`}>Sửa</Link>
                      <button onClick={() => remove(poi)}>Xóa</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}
