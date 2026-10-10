'use client';
import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getPoiClient } from '@/lib/api-poi-client';
import {
  DAY_LABELS,
  emptyPoiDraft,
  poiToDraft,
  type Locale,
  type Poi,
  type PoiDraft,
} from '@/lib/poi-contract';
import { withPrimaryEntrance } from '@/lib/poi-entrance';
import { validatePoi } from '@/lib/poi-validation';
import { useUnsavedGuard } from '@/hooks/use-unsaved-guard';
import { getDevicePosition } from '@/lib/geolocate';
import { categoryOptions } from '@/lib/poi-categories';
import { loadWalkNodes } from '@/lib/walk-nodes';
import { StatusBadge } from './status-badge';
import { PoiLocationMap } from './poi-location-map';
import { NarrationPanel } from './narration-panel';

const clientPromise = getPoiClient();
export function PoiForm({
  id,
  initial = emptyPoiDraft(),
  current,
}: {
  id?: string;
  initial?: PoiDraft;
  current?: Poi;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState(() => structuredClone(initial));
  const [baseline, setBaseline] = useState(() => JSON.stringify(initial));
  const [poi, setPoi] = useState(current);
  const [locale, setLocale] = useState<Locale>('vi');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [locating, setLocating] = useState(false);
  const [locationNote, setLocationNote] = useState('');
  const dirty = useMemo(
    () => JSON.stringify(draft) !== baseline,
    [draft, baseline],
  );
  const canLeave = useUnsavedGuard(dirty);
  const translation = draft.translations.find(
    (item) => item.locale === locale,
  )!;
  const fieldError = (key: string) =>
    errors[key] ? <small className="field-error">{errors[key]}</small> : null;
  const setTranslation = (
    field: 'name' | 'shortDescription' | 'longDescription',
    value: string,
  ) =>
    setDraft((valueBefore) => ({
      ...valueBefore,
      translations: valueBefore.translations.map((item) =>
        item.locale === locale ? { ...item, [field]: value } : item,
      ),
    }));

  async function useMyLocation() {
    setLocating(true);
    setLocationNote('');
    try {
      const fix = await getDevicePosition();
      setDraft((before) => ({
        ...before,
        location: {
          latitude: Number(fix.latitude.toFixed(7)),
          longitude: Number(fix.longitude.toFixed(7)),
        },
      }));
      setLocationNote(
        `Đã lấy vị trí hiện tại (sai số khoảng ${Math.round(fix.accuracyMeters)} m).`,
      );
    } catch (cause) {
      setLocationNote(
        cause instanceof Error ? cause.message : 'Không lấy được vị trí.',
      );
    } finally {
      setLocating(false);
    }
  }

  async function save() {
    setMessage('');
    let toSave = draft;
    try {
      toSave = withPrimaryEntrance(
        draft,
        (JSON.parse(baseline) as PoiDraft).location,
        await loadWalkNodes(),
      );
    } catch {
      // Without the path data a place that already has an entrance can still be saved.
    }
    const validation = validatePoi(toSave);
    setErrors(validation);
    if (Object.keys(validation).length) {
      setMessage(
        validation.entrances
          ? 'Không tải được dữ liệu đường đi để gắn lối vào. Thử lại sau.'
          : '',
      );
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    setBusy(true);
    try {
      const client = await clientPromise;
      const saved = id
        ? await client.update(id, toSave)
        : await client.create(toSave);
      const savedDraft = poiToDraft(saved);
      setPoi(saved);
      setDraft(savedDraft);
      setBaseline(JSON.stringify(savedDraft));
      if (!id) router.replace(`/pois/${saved.id}`);
      setMessage('Đã lưu nội dung POI.');
    } catch (reason) {
      setMessage(
        reason instanceof Error ? reason.message : 'Không thể lưu POI.',
      );
    } finally {
      setBusy(false);
    }
  }
  async function workflow(
    action: 'submit' | 'approve' | 'reject',
    reason = '',
  ) {
    if (!poi || !id) return;
    setBusy(true);
    setMessage('');
    try {
      const client = await clientPromise;
      const updated =
        action === 'submit'
          ? await client.submit(id)
          : action === 'approve'
            ? await client.approve(poi.pendingVersionId!)
            : await client.reject(poi.pendingVersionId!, reason);
      setPoi(updated);
      setMessage('Workflow đã được cập nhật.');
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'Workflow thất bại.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <section>
      <div className="title-row">
        <div>
          <p className="eyebrow">{id ? 'CHỈNH SỬA' : 'TẠO MỚI'}</p>
          <h1>{id ? 'Cập nhật điểm tham quan' : 'Thêm điểm tham quan'}</h1>
          <p>Lưu nội dung trước, sau đó dùng hành động workflow riêng.</p>
        </div>
        <div className="button-row">
          <button
            className="button ghost"
            onClick={() => canLeave() && router.push('/pois')}
          >
            Hủy
          </button>
          <button
            className="button primary"
            disabled={busy || poi?.status === 'pending_review'}
            onClick={save}
          >
            {busy ? 'Đang xử lý…' : 'Lưu POI'}
          </button>
        </div>
      </div>
      {message && (
        <div className="alert" role="status">
          {message}
        </div>
      )}
      {Object.keys(errors).length > 0 && (
        <div className="alert error">
          Cần sửa {Object.keys(errors).length} trường trước khi lưu.
        </div>
      )}
      <div className="form-grid">
        <div className="form-main">
          <div className="panel card">
            <h2>Nội dung đa ngôn ngữ</h2>
            <div className="tabs">
              {(['vi', 'en'] as const).map((item) => (
                <button
                  key={item}
                  className={locale === item ? 'selected' : ''}
                  onClick={() => setLocale(item)}
                >
                  {item === 'vi' ? '🇻🇳 Tiếng Việt' : '🇬🇧 English'}{' '}
                  {errors[`translations.${item}.name`] && <i>!</i>}
                </button>
              ))}
            </div>
            <label>
              Tên địa điểm
              <input
                value={translation.name}
                onChange={(e) => setTranslation('name', e.target.value)}
              />
              {fieldError(`translations.${locale}.name`)}
            </label>
            <label>
              Mô tả ngắn
              <textarea
                rows={3}
                value={translation.shortDescription}
                onChange={(e) =>
                  setTranslation('shortDescription', e.target.value)
                }
              />
              {fieldError(`translations.${locale}.shortDescription`)}
            </label>
            <label>
              Mô tả dài
              <textarea
                rows={7}
                value={translation.longDescription}
                onChange={(e) =>
                  setTranslation('longDescription', e.target.value)
                }
              />
              {fieldError(`translations.${locale}.longDescription`)}
            </label>
          </div>
          {id && <NarrationPanel poiId={id} />}
          <div className="panel card">
            <div className="section-heading">
              <div>
                <h2>Vị trí POI</h2>
                <p>
                  WGS84; lối vào dẫn đường tự gắn vào đường đi gần nhất khi lưu.
                </p>
              </div>
              <span className="tag">WGS84</span>
            </div>
            <div className="coords">
              <label>
                Vĩ độ
                <input
                  type="number"
                  step="any"
                  value={draft.location.latitude}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      location: {
                        ...draft.location,
                        latitude: Number(e.target.value),
                      },
                    })
                  }
                />
                {fieldError('latitude')}
              </label>
              <label>
                Kinh độ
                <input
                  type="number"
                  step="any"
                  value={draft.location.longitude}
                  onChange={(e) =>
                    setDraft({
                      ...draft,
                      location: {
                        ...draft.location,
                        longitude: Number(e.target.value),
                      },
                    })
                  }
                />
                {fieldError('longitude')}
              </label>
            </div>
            <div className="geo-actions">
              <button
                type="button"
                className="button ghost small"
                disabled={locating || poi?.status === 'pending_review'}
                onClick={() => void useMyLocation()}
              >
                {locating ? 'Đang lấy vị trí…' : '📍 Dùng vị trí hiện tại'}
              </button>
              {locationNote && (
                <small className="geo-note" role="status">
                  {locationNote}
                </small>
              )}
            </div>
            <PoiLocationMap
              poi={draft.location}
              entrances={draft.entrances.map((item) => ({
                ...item.location,
                isPrimary: item.isPrimary,
              }))}
              onPick={
                poi?.status === 'pending_review'
                  ? undefined
                  : (point) => setDraft({ ...draft, location: point })
              }
            />
            <small className="helper">
              Bấm lên bản đồ để đặt vị trí. Chấm xanh = POI, chấm vàng = lối vào
              dẫn đường (tự gắn khi lưu).
            </small>
          </div>
          <HoursEditor draft={draft} setDraft={setDraft} errors={errors} />
        </div>
        <aside className="form-side">
          <div className="panel card">
            <h2>Workflow</h2>
            {poi ? (
              <>
                <StatusBadge status={poi.status} />
                {poi.status === 'pending_review' && (
                  <p className="helper">
                    Nội dung chờ duyệt không thể chỉnh sửa.
                  </p>
                )}
                {poi.rejectionReason && (
                  <p className="field-error">Lý do: {poi.rejectionReason}</p>
                )}
                <WorkflowActions poi={poi} busy={busy} run={workflow} />
              </>
            ) : (
              <p>Lưu bản nháp để bật workflow.</p>
            )}
            <div className="role-note light">
              Backend áp dụng RBAC: Editor gửi duyệt; Reviewer/Admin duyệt hoặc
              từ chối.
            </div>
          </div>
          <div className="panel card">
            <h2>Định danh</h2>
            <label>
              Slug
              <input
                placeholder="ho-cuu-long"
                value={draft.slug}
                onChange={(e) => setDraft({ ...draft, slug: e.target.value })}
              />
              {fieldError('slug')}
            </label>
            <label>
              Loại địa điểm
              <select
                value={draft.category}
                onChange={(e) =>
                  setDraft({ ...draft, category: e.target.value })
                }
              >
                {!draft.category && <option value="">Chọn loại…</option>}
                {categoryOptions(draft.category).map((item) => (
                  <option key={item.slug} value={item.slug}>
                    {item.label}
                  </option>
                ))}
              </select>
              {fieldError('category')}
            </label>
          </div>
          <div className="panel card checklist">
            <h2>Mức độ hoàn thiện</h2>
            <p
              className={
                draft.translations.find((t) => t.locale === 'vi')
                  ?.longDescription
                  ? 'ok'
                  : ''
              }
            >
              Nội dung tiếng Việt
            </p>
            <p
              className={
                draft.translations.find((t) => t.locale === 'en')
                  ?.longDescription
                  ? 'ok'
                  : ''
              }
            >
              Nội dung English
            </p>
            <p>Thuyết minh: thêm ở mục thuyết minh sau khi lưu POI</p>
          </div>
        </aside>
      </div>
      {dirty && <div className="unsaved">● Có thay đổi chưa lưu</div>}
    </section>
  );
}

function WorkflowActions({
  poi,
  busy,
  run,
}: {
  poi: Poi;
  busy: boolean;
  run: (
    action: 'submit' | 'approve' | 'reject',
    reason?: string,
  ) => Promise<void>;
}) {
  const [reason, setReason] = useState('');
  if (poi.status === 'draft' || poi.status === 'rejected')
    return (
      <button
        className="button primary workflow-button"
        disabled={busy}
        onClick={() => run('submit')}
      >
        Gửi duyệt
      </button>
    );
  if (poi.status === 'pending_review' && poi.pendingVersionId)
    return (
      <div className="workflow-actions">
        <button
          className="button primary"
          disabled={busy}
          onClick={() => run('approve')}
        >
          Duyệt & xuất bản
        </button>
        <textarea
          rows={3}
          placeholder="Lý do từ chối (ít nhất 3 ký tự)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
        <button
          className="button danger"
          disabled={busy || reason.trim().length < 3}
          onClick={() => run('reject', reason)}
        >
          Từ chối
        </button>
      </div>
    );
  return <p>Không có hành động workflow phù hợp.</p>;
}

function HoursEditor({
  draft,
  setDraft,
  errors,
}: {
  draft: PoiDraft;
  setDraft: (value: PoiDraft) => void;
  errors: Record<string, string>;
}) {
  return (
    <div className="panel card">
      <h2>Giờ hoạt động</h2>
      <p className="helper">
        Ngày đóng cửa sẽ bị loại khỏi payload vì backend chưa có `isClosed`.
      </p>
      {draft.operatingHours.map((hour, index) => (
        <div className="hours-row" key={hour.dayOfWeek}>
          <b>{DAY_LABELS[hour.dayOfWeek]}</b>
          <label className="inline">
            <input
              type="checkbox"
              checked={hour.isClosed}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  operatingHours: draft.operatingHours.map((item, i) =>
                    i === index
                      ? { ...item, isClosed: e.target.checked }
                      : item,
                  ),
                })
              }
            />{' '}
            Đóng cửa
          </label>
          <input
            type="time"
            disabled={hour.isClosed}
            value={hour.opensAt}
            onChange={(e) =>
              setDraft({
                ...draft,
                operatingHours: draft.operatingHours.map((item, i) =>
                  i === index ? { ...item, opensAt: e.target.value } : item,
                ),
              })
            }
          />
          <span>–</span>
          <input
            type="time"
            disabled={hour.isClosed}
            value={hour.closesAt}
            onChange={(e) =>
              setDraft({
                ...draft,
                operatingHours: draft.operatingHours.map((item, i) =>
                  i === index ? { ...item, closesAt: e.target.value } : item,
                ),
              })
            }
          />
          {errors[`operatingHours.${index}`] && (
            <small className="field-error">
              {errors[`operatingHours.${index}`]}
            </small>
          )}
        </div>
      ))}
    </div>
  );
}
