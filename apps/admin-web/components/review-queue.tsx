'use client';
import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { fieldApi } from '@/lib/field-client';
import { readAuthSession } from '@/lib/auth-session';
import { categoryLabel } from '@/lib/poi-categories';
import {
  REVIEW_TABS,
  countByTab,
  missingForSubmit,
  type ReviewTab,
} from '@/lib/review-queue';
import type { AdminPoi } from '@damsen/shared-types';
import { PoiLocationMap } from './poi-location-map';
import { StatusBadge } from './status-badge';

/** Moderation: approve or reject what editors submitted (and push drafts forward). */
export function ReviewQueue() {
  // Read after mount: the server render has no session (avoids a hydration mismatch).
  const [roles, setRoles] = useState<string[]>([]);
  useEffect(() => setRoles(readAuthSession()?.user.roles ?? []), []);
  const canReview = roles.includes('REVIEWER') || roles.includes('ADMIN');
  const canSubmit = canReview || roles.includes('EDITOR');
  const [pois, setPois] = useState<AdminPoi[]>([]);
  const [tab, setTab] = useState<ReviewTab>('pending_review');
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [rejecting, setRejecting] = useState('');
  const [reason, setReason] = useState('');
  const [mapFor, setMapFor] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setPois(await fieldApi.listPois());
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : 'Không tải được danh sách.',
      );
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const counts = useMemo(() => countByTab(pois), [pois]);
  const rows = pois.filter((poi) => poi.status === tab);
  const nameOf = (poi: AdminPoi) =>
    poi.translations.find((item) => item.locale === 'vi')?.name ?? poi.slug;

  async function run(
    poi: AdminPoi,
    action: () => Promise<unknown>,
    done: string,
  ) {
    setBusy(poi.id);
    setMessage('');
    setError('');
    try {
      await action();
      setMessage(`${done}: “${nameOf(poi)}”.`);
      await load();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Thao tác thất bại.');
    } finally {
      setBusy('');
    }
  }

  const approve = (poi: AdminPoi) =>
    run(poi, () => fieldApi.approveVersion(poi.pendingVersionId!), 'Đã duyệt');
  const submit = (poi: AdminPoi) =>
    run(poi, () => fieldApi.submitPoi(poi.id), 'Đã gửi duyệt');

  async function reject(poi: AdminPoi) {
    await run(
      poi,
      () => fieldApi.rejectVersion(poi.pendingVersionId!, reason.trim()),
      'Đã từ chối',
    );
    setRejecting('');
    setReason('');
  }

  async function approveAll() {
    const targets = pois.filter(
      (poi) => poi.status === 'pending_review' && poi.pendingVersionId,
    );
    if (!window.confirm(`Duyệt tất cả ${targets.length} địa điểm đang chờ?`))
      return;
    setBusy('all');
    setMessage('');
    setError('');
    let ok = 0;
    const failed: string[] = [];
    for (const poi of targets) {
      try {
        await fieldApi.approveVersion(poi.pendingVersionId!);
        ok += 1;
      } catch {
        failed.push(nameOf(poi));
      }
    }
    setMessage(`Đã duyệt ${ok}/${targets.length}.`);
    if (failed.length) setError(`Không duyệt được: ${failed.join(', ')}.`);
    setBusy('');
    await load();
  }

  return (
    <section>
      <div className="title-row">
        <div>
          <p className="eyebrow">KIỂM DUYỆT</p>
          <h1>Duyệt địa điểm</h1>
          <p>
            Địa điểm editor gửi lên (kể cả thêm tại hiện trường) chỉ hiện ở
            visitor sau khi được duyệt.
          </p>
        </div>
        <div className="button-row">
          <Link className="button ghost" href="/field/review">
            Duyệt kết quả đo thực địa
          </Link>
          {canReview &&
            counts.pending_review > 1 &&
            tab === 'pending_review' && (
              <button
                className="button primary"
                disabled={busy === 'all'}
                onClick={() => void approveAll()}
              >
                Duyệt tất cả ({counts.pending_review})
              </button>
            )}
        </div>
      </div>
      {!canReview && (
        <div className="alert">
          Bạn chỉ xem được hàng đợi. Reviewer hoặc Admin mới duyệt hoặc từ chối.
        </div>
      )}
      {message && (
        <div className="alert" role="status">
          {message}
        </div>
      )}
      {error && (
        <div className="alert error" role="alert">
          {error}
        </div>
      )}
      <div className="review-tabs" role="tablist">
        {REVIEW_TABS.map((item) => (
          <button
            key={item.id}
            role="tab"
            aria-selected={tab === item.id}
            className={`button ${tab === item.id ? 'primary' : 'ghost'}`}
            onClick={() => setTab(item.id)}
          >
            {item.label} ({counts[item.id]})
          </button>
        ))}
      </div>
      {loading && pois.length === 0 ? (
        <p className="helper">Đang tải…</p>
      ) : rows.length === 0 ? (
        <div className="panel state">Không có địa điểm nào trong mục này.</div>
      ) : (
        <div className="review-grid">
          {rows.map((poi) => {
            const missing = missingForSubmit(poi);
            const english = poi.translations.find(
              (item) => item.locale === 'en',
            )?.name;
            return (
              <article key={poi.id} className="panel card review-card">
                <div className="section-heading">
                  <h3>
                    {nameOf(poi)}{' '}
                    {english && english !== nameOf(poi) ? (
                      <small>· {english}</small>
                    ) : null}
                  </h3>
                  <StatusBadge status={poi.status} />
                </div>
                <div className="review-meta">
                  <span>{categoryLabel(poi.category)}</span>
                  <span>
                    {poi.location.latitude.toFixed(6)},{' '}
                    {poi.location.longitude.toFixed(6)}
                  </span>
                  <span>
                    cổng:{' '}
                    {poi.entrances.map((e) => e.graphNodeRef).join(', ') ||
                      'chưa có'}
                  </span>
                </div>
                {poi.rejectionReason && (
                  <p className="field-error">
                    Lý do từ chối: {poi.rejectionReason}
                  </p>
                )}
                {tab !== 'pending_review' && missing.length > 0 && (
                  <p className="review-warn">
                    Chưa gửi duyệt được: {missing.join('; ')}.
                  </p>
                )}
                <div className="button-row">
                  <button
                    className="button ghost small"
                    onClick={() => setMapFor(mapFor === poi.id ? '' : poi.id)}
                  >
                    {mapFor === poi.id ? 'Ẩn bản đồ' : 'Xem bản đồ'}
                  </button>
                  <Link className="button ghost small" href={`/pois/${poi.id}`}>
                    Mở để sửa
                  </Link>
                  {tab === 'pending_review' && (
                    <>
                      <button
                        className="button primary small"
                        disabled={
                          !canReview || busy === poi.id || !poi.pendingVersionId
                        }
                        title={canReview ? '' : 'Chỉ Reviewer/Admin được duyệt'}
                        onClick={() => void approve(poi)}
                      >
                        Duyệt
                      </button>
                      <button
                        className="button ghost small"
                        disabled={!canReview || busy === poi.id}
                        onClick={() =>
                          setRejecting(rejecting === poi.id ? '' : poi.id)
                        }
                      >
                        Từ chối…
                      </button>
                    </>
                  )}
                  {tab !== 'pending_review' && (
                    <button
                      className="button primary small"
                      disabled={
                        !canSubmit || busy === poi.id || missing.length > 0
                      }
                      onClick={() => void submit(poi)}
                    >
                      Gửi duyệt
                    </button>
                  )}
                </div>
                {rejecting === poi.id && (
                  <div className="reject-box">
                    <label>
                      Lý do từ chối (ít nhất 3 ký tự)
                      <textarea
                        rows={2}
                        value={reason}
                        onChange={(e) => setReason(e.target.value)}
                      />
                    </label>
                    <button
                      className="button danger small"
                      disabled={reason.trim().length < 3 || busy === poi.id}
                      onClick={() => void reject(poi)}
                    >
                      Xác nhận từ chối
                    </button>
                  </div>
                )}
                {mapFor === poi.id && (
                  <PoiLocationMap
                    poi={poi.location}
                    entrances={poi.entrances.map((e) => ({
                      ...e.location,
                      isPrimary: e.isPrimary,
                    }))}
                  />
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
