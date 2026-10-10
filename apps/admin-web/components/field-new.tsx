'use client';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useMeasurement } from '@/hooks/use-measurement';
import { useWatchPosition } from '@/hooks/use-watch-position';
import { readAuthSession } from '@/lib/auth-session';
import { fieldApi } from '@/lib/field-client';
import { makeFieldSlug } from '@/lib/field-slug';
import { gpsQuality } from '@/lib/gps-sampler';
import { POI_CATEGORIES } from '@/lib/poi-categories';
import {
  MAX_SNAP_METERS,
  loadWalkNodes,
  nearestWalkNode,
  type SnapResult,
} from '@/lib/walk-nodes';
import { FieldMap } from './field-map';
import { FieldShell } from './field-shell';

type Mode = 'draft' | 'review' | 'publish';

/** Add a place where you stand: measure, name it, pick its type, send it to moderation. */
export function FieldNew() {
  const { fix, error: gpsError } = useWatchPosition();
  const measurement = useMeasurement(fix);
  const roles = readAuthSession()?.user.roles ?? [];
  const canPublish = roles.includes('REVIEWER') || roles.includes('ADMIN');
  const [nameVi, setNameVi] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [category, setCategory] = useState('landmark');
  const [note, setNote] = useState('');
  const [snap, setSnap] = useState<SnapResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [created, setCreated] = useState<{ id: string; label: string } | null>(
    null,
  );
  const summary = measurement.summary;

  useEffect(() => {
    if (!summary) {
      setSnap(null);
      return;
    }
    let active = true;
    loadWalkNodes()
      .then((nodes) => active && setSnap(nearestWalkNode(nodes, summary)))
      .catch(() => active && setSnap(null));
    return () => {
      active = false;
    };
  }, [summary]);

  async function save(mode: Mode) {
    if (!summary || !snap) return;
    setBusy(true);
    setMessage('');
    try {
      const text = note.trim() || 'Địa điểm thêm tại hiện trường.';
      const poi = await fieldApi.createPoi({
        slug: makeFieldSlug(nameVi),
        category,
        location: { latitude: summary.latitude, longitude: summary.longitude },
        translations: [
          {
            locale: 'vi',
            name: nameVi.trim(),
            shortDescription: text,
            longDescription: text,
          },
          {
            locale: 'en',
            name: nameEn.trim() || nameVi.trim(),
            shortDescription: text,
            longDescription: text,
          },
        ],
        entrances: [
          {
            labelVi: 'Lối vào',
            labelEn: 'Entrance',
            location: { latitude: snap.node.lat, longitude: snap.node.lon },
            graphNodeRef: snap.node.ref,
            isPrimary: true,
            accessibility: 'standard',
          },
        ],
        operatingHours: [],
      });
      let label = 'Đã lưu bản nháp.';
      if (mode !== 'draft') {
        const pending = await fieldApi.submitPoi(poi.id);
        label = 'Đã gửi duyệt (mục Kiểm duyệt).';
        if (mode === 'publish' && pending.pendingVersionId) {
          await fieldApi.approveVersion(pending.pendingVersionId);
          label = 'Đã xuất bản — visitor thấy ngay.';
        }
      }
      setCreated({ id: poi.id, label });
    } catch (cause) {
      setMessage(
        `${cause instanceof Error ? cause.message : 'Không lưu được.'} (cần có mạng để thêm địa điểm mới)`,
      );
    } finally {
      setBusy(false);
    }
  }

  function reset() {
    measurement.cancel();
    setNameVi('');
    setNameEn('');
    setNote('');
    setCreated(null);
    setMessage('');
  }

  if (created) {
    return (
      <FieldShell
        title="Đã thêm địa điểm"
        back={{ href: '/field', label: 'Danh sách' }}
      >
        <div className="alert" role="status">
          ✔ {created.label}
        </div>
        <div className="button-row">
          <Link className="button primary big" href={`/field/${created.id}`}>
            Mở để đo lại / kiểm tra
          </Link>
          <button className="button ghost big" onClick={reset}>
            Thêm địa điểm khác
          </button>
        </div>
      </FieldShell>
    );
  }

  const tooCoarse = summary ? summary.accuracyMeters > 50 : false;
  const ready = Boolean(summary && snap && nameVi.trim() && !tooCoarse);

  return (
    <FieldShell
      title="Thêm địa điểm tại đây"
      back={{ href: '/field', label: 'Danh sách' }}
    >
      <FieldMap
        markers={[
          ...(summary
            ? [{ kind: 'measured' as const, ...summary, title: 'Vị trí đo' }]
            : []),
          ...(fix
            ? [
                {
                  kind: 'me' as const,
                  latitude: fix.latitude,
                  longitude: fix.longitude,
                  title: 'Bạn',
                },
              ]
            : []),
        ]}
        {...(fix
          ? {
              circle: {
                latitude: fix.latitude,
                longitude: fix.longitude,
                meters: fix.accuracyMeters,
              },
            }
          : {})}
        fitKey={`new:${fix ? 'fix' : 'nofix'}:${summary ? 'done' : ''}`}
      />
      <section className="field-card">
        {measurement.phase === 'idle' && (
          <>
            <b>Bước 1 — đo vị trí</b>
            <small>Đứng ngay giữa địa điểm, ra chỗ thoáng, rồi bấm đo.</small>
            <button
              className="button primary big"
              disabled={!fix}
              onClick={measurement.start}
            >
              📍 Đo vị trí tại đây
            </button>
            {!fix && <small>{gpsError || 'Đang chờ GPS…'}</small>}
          </>
        )}
        {measurement.phase === 'measuring' && (
          <>
            <b>Đang đo — đứng yên…</b>
            <div className="field-bar">
              <span
                style={{
                  width: `${Math.min(100, ((Math.min(measurement.goodSamples, measurement.needSamples) / measurement.needSamples + measurement.elapsedMs / measurement.needMs) / 2) * 100)}%`,
                }}
              />
            </div>
            <small>
              {measurement.goodSamples}/{measurement.needSamples} mẫu tốt ·{' '}
              {Math.round(measurement.elapsedMs / 1000)}/
              {measurement.needMs / 1000} s
              {fix ? ` · GPS ±${Math.round(fix.accuracyMeters)} m` : ''}
            </small>
            <button className="button ghost" onClick={measurement.cancel}>
              Hủy
            </button>
          </>
        )}
        {summary && (
          <>
            <b>
              {summary.latitude}, {summary.longitude}
            </b>
            <span className={`field-gps ${gpsQuality(summary.accuracyMeters)}`}>
              sai số ±{summary.accuracyMeters} m ({summary.sampleCount} mẫu)
            </span>
            {snap && (
              <small>
                Lối vào gắn vào đường: {snap.node.ref} (
                {Math.round(snap.distanceMeters)} m
                {snap.distanceMeters > MAX_SNAP_METERS
                  ? ' — xa đường đi bộ, chỉ đường tới đây có thể không chạy'
                  : ''}
                )
              </small>
            )}
            {tooCoarse && (
              <div className="alert error">
                GPS quá thô (&gt; 50 m). Hãy đo lại ở chỗ thoáng.
              </div>
            )}
            <button className="button ghost" onClick={measurement.start}>
              Đo lại
            </button>
          </>
        )}
      </section>

      {summary && (
        <section className="field-card" aria-label="Thông tin địa điểm">
          <b>Bước 2 — thông tin</b>
          <label>
            Tên tiếng Việt (bắt buộc)
            <input
              value={nameVi}
              onChange={(e) => setNameVi(e.target.value)}
              placeholder="VD: Quầy nước Hoa Sen"
            />
          </label>
          <label>
            Tên tiếng Anh (để trống = dùng tên Việt)
            <input value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
          </label>
          <label>
            Loại địa điểm
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
            >
              {POI_CATEGORIES.map((item) => (
                <option key={item.slug} value={item.slug}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Mô tả ngắn (tùy chọn)
            <textarea
              rows={2}
              maxLength={500}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </label>
          {message && (
            <div className="alert error" role="alert">
              {message}
            </div>
          )}
          <div className="button-row">
            {canPublish && (
              <button
                className="button primary"
                disabled={!ready || busy}
                onClick={() => void save('publish')}
              >
                Lưu và xuất bản luôn
              </button>
            )}
            <button
              className={`button ${canPublish ? 'ghost' : 'primary'}`}
              disabled={!ready || busy}
              onClick={() => void save('review')}
            >
              Lưu và gửi duyệt
            </button>
            <button
              className="button ghost"
              disabled={!ready || busy}
              onClick={() => void save('draft')}
            >
              Chỉ lưu nháp
            </button>
          </div>
        </section>
      )}
    </FieldShell>
  );
}
