'use client';
import type {
  AdminPoi,
  FieldCheckInput,
  FieldCheckOutcome,
} from '@damsen/shared-types';
import { useEffect, useMemo, useRef, useState } from 'react';
import { useFieldData } from '@/hooks/use-field-data';
import { useWatchPosition, type LiveFix } from '@/hooks/use-watch-position';
import { readAuthSession } from '@/lib/auth-session';
import { fieldApi } from '@/lib/field-client';
import { enqueueCheck } from '@/lib/field-queue';
import { describeOffset, formatMetres } from '@/lib/geo-math';
import {
  MIN_DURATION_MS,
  MIN_SAMPLES,
  gpsQuality,
  isMeasurementReady,
  summarizeSamples,
  usableSamples,
  type GpsSample,
  type GpsSummary,
} from '@/lib/gps-sampler';
import {
  FIELD_STATUS_LABEL,
  summarizePois as summarize,
} from '@/lib/field-status';
import {
  MAX_SNAP_METERS,
  distanceMeters,
  loadWalkNodes,
  nearestWalkNode,
} from '@/lib/walk-nodes';
import { FieldMap, type FieldMarker } from './field-map';
import { FieldShell } from './field-shell';

type Target = { kind: 'poi' } | { kind: 'entrance'; entranceId: string };
type PathAnswer = 'yes' | 'no' | 'unknown';

interface Draft {
  target: Target;
  summary: GpsSummary;
  outcome: FieldCheckOutcome;
  path: PathAnswer;
  note: string;
  snap?: string;
}

const OUTCOMES: { id: FieldCheckOutcome; label: string }[] = [
  { id: 'confirmed', label: 'Đúng vị trí' },
  { id: 'corrected', label: 'Đã đo lại' },
  { id: 'problem', label: 'Có vấn đề' },
];

const referenceOf = (poi: AdminPoi, target: Target) =>
  target.kind === 'poi'
    ? poi.location
    : (poi.entrances.find((item) => item.id === target.entranceId)?.location ??
      poi.location);

export function FieldPoi({ id }: { id: string }) {
  const data = useFieldData();
  const { fix, error: gpsError } = useWatchPosition();
  const poi = data.pois.find((item) => item.id === id);
  const [measuring, setMeasuring] = useState<{
    target: Target;
    startedAt: number;
    samples: GpsSample[];
  } | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [draft, setDraft] = useState<Draft | null>(null);
  const [notice, setNotice] = useState('');
  const lastTimestamp = useRef(0);
  const roles = readAuthSession()?.user.roles ?? [];
  const canApply = roles.includes('REVIEWER') || roles.includes('ADMIN');

  // Collect fixes while measuring.
  useEffect(() => {
    if (!measuring || !fix || fix.timestamp === lastTimestamp.current) return;
    // A fix taken before you tapped "measure" shows where you were, not where you are.
    if (fix.timestamp < measuring.startedAt - 300) return;
    lastTimestamp.current = fix.timestamp;
    setMeasuring((before) =>
      before ? { ...before, samples: [...before.samples, { ...fix }] } : before,
    );
  }, [fix, measuring]);

  // Tick for the progress display, and finish when enough good fixes were collected.
  useEffect(() => {
    if (!measuring) return;
    const timer = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(timer);
  }, [measuring]);

  useEffect(() => {
    if (!measuring || !poi) return;
    if (!isMeasurementReady(measuring.samples, measuring.startedAt, now))
      return;
    const summary = summarizeSamples(measuring.samples);
    setMeasuring(null);
    if (summary) void startDraft(measuring.target, summary);
  }, [measuring, now, poi]);

  async function startDraft(
    target: Target,
    summary: GpsSummary,
    outcome?: FieldCheckOutcome,
  ) {
    if (!poi) return;
    const offset = distanceMeters(summary, referenceOf(poi, target));
    const suggested: FieldCheckOutcome =
      outcome ??
      (offset <= Math.max(6, summary.accuracyMeters)
        ? 'confirmed'
        : 'corrected');
    let snap: string | undefined;
    if (target.kind === 'entrance') {
      try {
        const near = nearestWalkNode(await loadWalkNodes(), summary);
        if (near) {
          const metres = Math.round(near.distanceMeters);
          snap = `Điểm đường gần nhất: ${near.node.ref} (${metres} m${metres > MAX_SNAP_METERS ? ' — xa đường đi bộ' : ''})`;
        }
      } catch {
        // The suggestion is optional.
      }
    }
    setDraft({
      target,
      summary,
      outcome: suggested,
      path: 'unknown',
      note: '',
      ...(snap ? { snap } : {}),
    });
  }

  function begin(target: Target) {
    setNotice('');
    setDraft(null);
    lastTimestamp.current = 0;
    setNow(Date.now());
    setMeasuring({ target, startedAt: Date.now(), samples: [] });
  }

  function reportProblem() {
    if (!fix) return;
    setNotice('');
    void startDraft(
      { kind: 'poi' },
      {
        latitude: Number(fix.latitude.toFixed(7)),
        longitude: Number(fix.longitude.toFixed(7)),
        accuracyMeters: Number(fix.accuracyMeters.toFixed(1)),
        sampleCount: 1,
        spreadMeters: 0,
      },
      'problem',
    );
  }

  async function save(applyNow = false) {
    if (!poi || !draft) return;
    const input: FieldCheckInput = {
      clientId: crypto.randomUUID(),
      target: draft.target.kind,
      ...(draft.target.kind === 'entrance'
        ? { entranceId: draft.target.entranceId }
        : {}),
      location: {
        latitude: draft.summary.latitude,
        longitude: draft.summary.longitude,
      },
      accuracyMeters: draft.summary.accuracyMeters,
      sampleCount: draft.summary.sampleCount,
      outcome: draft.outcome,
      ...(draft.path === 'unknown' ? {} : { pathOk: draft.path === 'yes' }),
      ...(draft.note.trim() ? { note: draft.note.trim() } : {}),
    };
    enqueueCheck(poi.id, input);
    setDraft(null);
    const waiting = await data.sync();
    let message =
      waiting === 0
        ? '✔ Đã lưu và gửi lên máy chủ.'
        : '✔ Đã lưu trên máy. Sẽ tự gửi khi có mạng.';
    if (applyNow && waiting === 0) {
      try {
        message = await applyUploaded(input);
      } catch (cause) {
        message = `${message} Chưa cập nhật được địa điểm: ${cause instanceof Error ? cause.message : 'lỗi'}. Reviewer có thể áp dụng sau ở "Duyệt kết quả đo".`;
      }
    }
    setNotice(message);
    await data.refresh();
  }

  /** Reviewer/admin shortcut: move the POI/entrance to the spot just measured. */
  async function applyUploaded(input: FieldCheckInput): Promise<string> {
    const checks = await fieldApi.listChecks({
      poiId: poi!.id,
      unappliedOnly: true,
    });
    const stored = checks.find((item) => item.clientId === input.clientId);
    if (!stored) throw new Error('chưa thấy kết quả trên máy chủ');
    let graphNodeRef: string | undefined;
    if (stored.target === 'entrance') {
      const snap = nearestWalkNode(await loadWalkNodes(), stored.location);
      if (!snap) throw new Error('chưa có dữ liệu đường đi');
      if (snap.distanceMeters > MAX_SNAP_METERS) {
        throw new Error(
          `cổng cách đường đi bộ ${Math.round(snap.distanceMeters)} m, hãy đo lại gần đường`,
        );
      }
      graphNodeRef = snap.node.ref;
    }
    await fieldApi.applyCheck(stored.id, graphNodeRef ? { graphNodeRef } : {});
    return `✔ Đã cập nhật vị trí ${stored.target === 'poi' ? 'địa điểm' : 'cổng'} (địa điểm vẫn ở trạng thái ${poi!.status}).`;
  }

  const summary = useMemo(
    () => (poi ? summarize([poi], data.checks)[0] : undefined),
    [poi, data.checks],
  );
  const own = data.checks.filter((check) => check.poiId === id);
  const pending = data.queue.filter((item) => item.poiId === id);

  if (!poi) {
    return (
      <FieldShell
        title="Địa điểm"
        back={{ href: '/field', label: 'Danh sách' }}
      >
        <p className="helper">
          {data.loading
            ? 'Đang tải…'
            : data.error || 'Không tìm thấy địa điểm.'}
        </p>
      </FieldShell>
    );
  }

  const name =
    poi.translations.find((t) => t.locale === 'vi')?.name ?? poi.slug;
  const markers: FieldMarker[] = [
    { kind: 'poi', ...poi.location, title: name },
    ...poi.entrances.map((e) => ({
      kind: 'entrance' as const,
      ...e.location,
      title: e.labelVi,
    })),
    ...(draft
      ? [{ kind: 'measured' as const, ...draft.summary, title: 'Điểm vừa đo' }]
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
  ];
  const progressSamples = measuring
    ? usableSamples(measuring.samples).length
    : 0;
  const elapsed = measuring
    ? Math.min(MIN_DURATION_MS, now - measuring.startedAt)
    : 0;
  const tooCoarse = draft ? draft.summary.accuracyMeters > 50 : false;
  const needsNote = draft?.outcome === 'problem' && !draft.note.trim();

  return (
    <FieldShell title={name} back={{ href: '/field', label: 'Danh sách' }}>
      <FieldMap
        markers={markers}
        {...(fix
          ? {
              circle: {
                latitude: fix.latitude,
                longitude: fix.longitude,
                meters: fix.accuracyMeters,
              },
            }
          : {})}
        fitKey={`${poi.id}:${fix ? 'fix' : 'nofix'}:${draft ? 'draft' : ''}`}
      />
      <section className="field-card" aria-label="Vị trí của bạn">
        <div className="field-where">
          {fix ? (
            <>
              <b>{describeOffset(fix, poi.location)}</b>
              <small>so với vị trí đang lưu của địa điểm</small>
            </>
          ) : (
            <b>{gpsError || 'Đang chờ GPS…'}</b>
          )}
        </div>
        {fix && <GpsBadge fix={fix} />}
        <div className="field-meta">
          <span className={`chip ${summary?.status ?? 'unchecked'}`}>
            {FIELD_STATUS_LABEL[summary?.status ?? 'unchecked']}
          </span>
          <small>
            {poi.status} · {poi.location.latitude.toFixed(6)},{' '}
            {poi.location.longitude.toFixed(6)}
          </small>
        </div>
      </section>

      {notice && (
        <div className="alert" role="status">
          {notice}
        </div>
      )}

      {measuring && (
        <section className="field-card measure" aria-live="polite">
          <b>
            Đang đo — đứng yên tại{' '}
            {measuring.target.kind === 'poi' ? 'giữa địa điểm' : 'cổng vào'}
          </b>
          <div className="field-bar">
            <span
              style={{
                width: `${Math.min(100, ((Math.min(progressSamples, MIN_SAMPLES) / MIN_SAMPLES + elapsed / MIN_DURATION_MS) / 2) * 100)}%`,
              }}
            />
          </div>
          <small>
            {progressSamples}/{MIN_SAMPLES} mẫu tốt ·{' '}
            {Math.round(elapsed / 1000)}/{MIN_DURATION_MS / 1000} s
            {fix ? ` · GPS ±${Math.round(fix.accuracyMeters)} m` : ''}
            {fix && fix.accuracyMeters > 25 ? ' (quá thô, ra chỗ thoáng)' : ''}
          </small>
          <button className="button ghost" onClick={() => setMeasuring(null)}>
            Hủy
          </button>
        </section>
      )}

      {draft && (
        <section className="field-card draft" aria-label="Kết quả đo">
          <h2>
            Kết quả đo —{' '}
            {draft.target.kind === 'poi' ? 'vị trí địa điểm' : 'cổng vào'}
          </h2>
          <p>
            <b>
              {draft.summary.latitude}, {draft.summary.longitude}
            </b>
            <br />
            <small>
              sai số ±{draft.summary.accuracyMeters} m (
              {draft.summary.sampleCount} mẫu) · lệch{' '}
              {formatMetres(
                distanceMeters(draft.summary, referenceOf(poi, draft.target)),
              )}{' '}
              so với vị trí đang lưu
            </small>
          </p>
          {draft.snap && <p className="helper">{draft.snap}</p>}
          {tooCoarse && (
            <div className="alert error">
              GPS quá thô (&gt; 50 m), máy chủ sẽ không nhận. Hãy đo lại ở chỗ
              thoáng.
            </div>
          )}
          <fieldset className="field-choices">
            <legend>Kết luận</legend>
            {OUTCOMES.map((item) => (
              <button
                key={item.id}
                className={draft.outcome === item.id ? 'selected' : ''}
                onClick={() => setDraft({ ...draft, outcome: item.id })}
              >
                {item.label}
              </button>
            ))}
          </fieldset>
          <fieldset className="field-choices">
            <legend>Đường đi tới đây</legend>
            {(
              [
                ['yes', 'Đi được'],
                ['no', 'Không đi được'],
                ['unknown', 'Chưa rõ'],
              ] as const
            ).map(([value, label]) => (
              <button
                key={value}
                className={draft.path === value ? 'selected' : ''}
                onClick={() => setDraft({ ...draft, path: value })}
              >
                {label}
              </button>
            ))}
          </fieldset>
          <label>
            Ghi chú{draft.outcome === 'problem' ? ' (bắt buộc)' : ''}
            <textarea
              rows={2}
              maxLength={500}
              value={draft.note}
              onChange={(event) =>
                setDraft({ ...draft, note: event.target.value })
              }
              placeholder="VD: cổng phụ cách 10 m về phía hồ; đường bị rào"
            />
          </label>
          <div className="button-row">
            {canApply && draft.outcome === 'corrected' && (
              <button
                className="button primary"
                disabled={tooCoarse || needsNote}
                onClick={() => void save(true)}
              >
                Lưu và cập nhật luôn
              </button>
            )}
            <button
              className={`button ${canApply && draft.outcome === 'corrected' ? 'ghost' : 'primary'}`}
              disabled={tooCoarse || needsNote}
              onClick={() => void save()}
            >
              Chỉ lưu kết quả
            </button>
            <button
              className="button ghost"
              onClick={() => begin(draft.target)}
            >
              Đo lại
            </button>
            <button className="button ghost" onClick={() => setDraft(null)}>
              Bỏ
            </button>
          </div>
        </section>
      )}

      {!measuring && !draft && (
        <section className="field-actions" aria-label="Hành động">
          <button
            className="button primary big"
            disabled={!fix}
            onClick={() => begin({ kind: 'poi' })}
          >
            📍 Đo vị trí địa điểm tại đây
          </button>
          {poi.entrances.map((entrance) => (
            <button
              key={entrance.id}
              className="button ghost big"
              disabled={!fix}
              onClick={() =>
                begin({ kind: 'entrance', entranceId: entrance.id ?? '' })
              }
            >
              🚪 Đo cổng: {entrance.labelVi || entrance.graphNodeRef}
            </button>
          ))}
          <button
            className="button ghost big warn"
            disabled={!fix}
            onClick={reportProblem}
          >
            ⚠ Báo vấn đề (đóng cửa, không thấy, đường bị chặn…)
          </button>
        </section>
      )}

      {(pending.length > 0 || own.length > 0) && (
        <section className="field-card" aria-label="Lịch sử">
          <h2>Đã ghi nhận</h2>
          <ul className="field-history">
            {pending.map((item) => (
              <li key={item.input.clientId}>
                <span className="chip pending">
                  {item.failure ? 'Bị từ chối' : 'Chờ gửi'}
                </span>{' '}
                {item.input.target === 'poi' ? 'Vị trí' : 'Cổng'} · ±
                {Math.round(item.input.accuracyMeters)} m
                {item.failure ? ` · ${item.failure}` : ''}
              </li>
            ))}
            {own.slice(0, 6).map((check) => (
              <li key={check.id}>
                <span className={`chip ${check.outcome}`}>
                  {OUTCOMES.find((o) => o.id === check.outcome)?.label}
                </span>{' '}
                {check.target === 'poi' ? 'Vị trí' : 'Cổng'} · lệch{' '}
                {formatMetres(check.distanceFromCurrentMeters)} · ±
                {Math.round(check.accuracyMeters)} m
                {check.appliedAt ? ' · đã áp dụng' : ''}
                {check.note ? ` · ${check.note}` : ''}
              </li>
            ))}
          </ul>
        </section>
      )}
    </FieldShell>
  );
}

function GpsBadge({ fix }: { fix: LiveFix }) {
  const quality = gpsQuality(fix.accuracyMeters);
  return (
    <span className={`field-gps ${quality}`}>
      GPS ±{Math.round(fix.accuracyMeters)} m ·{' '}
      {quality === 'good'
        ? 'tốt'
        : quality === 'ok'
          ? 'tạm được'
          : 'yếu — ra chỗ thoáng'}
    </span>
  );
}
