'use client';
import type { AdminPoi, FieldCheck } from '@damsen/shared-types';
import { useMemo, useState } from 'react';
import { useFieldData } from '@/hooks/use-field-data';
import { fieldApi } from '@/lib/field-client';
import { readAuthSession } from '@/lib/auth-session';
import { describeOffset, formatMetres } from '@/lib/geo-math';
import {
  MAX_SNAP_METERS,
  loadWalkNodes,
  nearestWalkNode,
} from '@/lib/walk-nodes';
import { FieldMap, type FieldMarker } from './field-map';
import { FieldShell } from './field-shell';

const OUTCOME_LABEL = {
  confirmed: 'Đúng vị trí',
  corrected: 'Đã đo lại',
  problem: 'Có vấn đề',
} as const;

function currentOf(poi: AdminPoi, check: FieldCheck) {
  return check.target === 'poi'
    ? poi.location
    : (poi.entrances.find((item) => item.id === check.entranceId)?.location ??
        poi.location);
}

/** Reviewer screen: compare each measurement with the saved position, then apply it. */
export function FieldReview() {
  const data = useFieldData();
  const roles = readAuthSession()?.user.roles ?? [];
  const canApply = roles.includes('REVIEWER') || roles.includes('ADMIN');
  const [busy, setBusy] = useState('');
  const [message, setMessage] = useState('');
  const [open, setOpen] = useState('');

  const rows = useMemo(
    () =>
      data.checks
        .filter((check) => !check.appliedAt)
        .map((check) => ({
          check,
          poi: data.pois.find((p) => p.id === check.poiId),
        }))
        .filter((row): row is { check: FieldCheck; poi: AdminPoi } =>
          Boolean(row.poi),
        ),
    [data.checks, data.pois],
  );
  const todo = rows.filter((row) => row.check.outcome === 'corrected');
  const problems = rows.filter((row) => row.check.outcome === 'problem');
  const confirmed = rows.filter((row) => row.check.outcome === 'confirmed');

  async function apply(check: FieldCheck, poi: AdminPoi) {
    setBusy(check.id);
    setMessage('');
    try {
      let graphNodeRef: string | undefined;
      if (check.target === 'entrance') {
        const snap = nearestWalkNode(await loadWalkNodes(), check.location);
        if (!snap) throw new Error('Chưa có dữ liệu đường đi để gắn cổng.');
        graphNodeRef = snap.node.ref;
        if (snap.distanceMeters > MAX_SNAP_METERS) {
          throw new Error(
            `Cổng cách đường đi bộ ${Math.round(snap.distanceMeters)} m (> ${MAX_SNAP_METERS} m): hãy đo lại gần đường.`,
          );
        }
      }
      await fieldApi.applyCheck(check.id, graphNodeRef ? { graphNodeRef } : {});
      const name =
        poi.translations.find((t) => t.locale === 'vi')?.name ?? poi.slug;
      setMessage(
        `Đã cập nhật vị trí "${name}" (vẫn ở trạng thái ${poi.status}).`,
      );
      await data.refresh();
    } catch (cause) {
      setMessage(
        cause instanceof Error ? cause.message : 'Không áp dụng được.',
      );
    } finally {
      setBusy('');
    }
  }

  const section = (title: string, list: typeof rows, applicable: boolean) => (
    <section className="field-card">
      <h2>
        {title} <small>({list.length})</small>
      </h2>
      {list.length === 0 && <p className="helper">Không có.</p>}
      <ul className="field-review">
        {list.map(({ check, poi }) => {
          const current = currentOf(poi, check);
          const name =
            poi.translations.find((t) => t.locale === 'vi')?.name ?? poi.slug;
          const markers: FieldMarker[] = [
            { kind: 'poi', ...current, title: 'Đang lưu' },
            { kind: 'measured', ...check.location, title: 'Vừa đo' },
          ];
          return (
            <li key={check.id}>
              <div className="field-review-head">
                <b>
                  {name} · {check.target === 'poi' ? 'vị trí' : 'cổng'}
                </b>
                <span className={`chip ${check.outcome}`}>
                  {OUTCOME_LABEL[check.outcome]}
                </span>
              </div>
              <small>
                đo lệch {formatMetres(check.distanceFromCurrentMeters)} (
                {describeOffset(current, check.location)}) · ±
                {Math.round(check.accuracyMeters)} m · {check.sampleCount} mẫu
                {check.pathOk === undefined
                  ? ''
                  : check.pathOk
                    ? ' · đường đi được'
                    : ' · đường KHÔNG đi được'}
                {check.note ? ` · “${check.note}”` : ''} ·{' '}
                {new Date(check.createdAt).toLocaleString('vi-VN')}
              </small>
              <div className="button-row">
                <button
                  className="button ghost small"
                  onClick={() => setOpen(open === check.id ? '' : check.id)}
                >
                  {open === check.id ? 'Ẩn bản đồ' : 'Xem bản đồ'}
                </button>
                {applicable && (
                  <button
                    className="button primary small"
                    disabled={!canApply || busy === check.id}
                    title={canApply ? '' : 'Chỉ Reviewer/Admin được áp dụng'}
                    onClick={() => void apply(check, poi)}
                  >
                    {busy === check.id ? 'Đang áp dụng…' : 'Áp dụng vị trí đo'}
                  </button>
                )}
              </div>
              {open === check.id && (
                <FieldMap
                  markers={markers}
                  fitKey={check.id}
                  className="field-map small"
                />
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );

  return (
    <FieldShell
      title="Duyệt kết quả đo"
      back={{ href: '/field', label: 'Hiện trường' }}
    >
      {!canApply && (
        <div className="alert">
          Bạn chỉ xem được. Reviewer hoặc Admin mới áp dụng vị trí đo vào địa
          điểm.
        </div>
      )}
      {message && (
        <div className="alert" role="status">
          {message}
        </div>
      )}
      {data.error && <div className="alert error">{data.error}</div>}
      {section('Cần áp dụng (đã đo lại)', todo, true)}
      {section('Có vấn đề', problems, false)}
      {section('Đã xác nhận đúng vị trí', confirmed, false)}
    </FieldShell>
  );
}
