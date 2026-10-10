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
import { validatePoi } from '@/lib/poi-validation';
import { useUnsavedGuard } from '@/hooks/use-unsaved-guard';
import { getDevicePosition } from '@/lib/geolocate';
import { categoryOptions } from '@/lib/poi-categories';
import {
  MAX_SNAP_METERS,
  loadWalkNodes,
  nearestWalkNode,
} from '@/lib/walk-nodes';
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
    const validation = validatePoi(draft);
    setErrors(validation);
    setMessage('');
    if (Object.keys(validation).length) {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }
    setBusy(true);
    try {
      const client = await clientPromise;
      const saved = id
        ? await client.update(id, draft)
        : await client.create(draft);
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
                <p>WGS84; cổng dẫn đường được quản lý riêng bên dưới.</p>
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
              Bấm lên bản đồ để đặt vị trí. Chấm xanh = POI, chấm vàng = cổng
              dẫn đường.
            </small>
          </div>
          <EntranceEditor draft={draft} setDraft={setDraft} errors={errors} />
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
            <p
              className={
                draft.entrances.some((item) => item.isPrimary) ? 'ok' : ''
              }
            >
              Cổng chính + graph node
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

function EntranceEditor({
  draft,
  setDraft,
  errors,
}: {
  draft: PoiDraft;
  setDraft: (value: PoiDraft) => void;
  errors: Record<string, string>;
}) {
  const [notes, setNotes] = useState<Record<number, string>>({});
  const [busyIndex, setBusyIndex] = useState<number | null>(null);
  const update = (
    index: number,
    patch: Partial<PoiDraft['entrances'][number]>,
  ) =>
    setDraft({
      ...draft,
      entrances: draft.entrances.map((item, i) =>
        i === index ? { ...item, ...patch } : item,
      ),
    });
  const note = (index: number, text: string) =>
    setNotes((before) => ({ ...before, [index]: text }));

  async function entranceFromDevice(index: number) {
    setBusyIndex(index);
    note(index, '');
    try {
      const fix = await getDevicePosition();
      update(index, {
        location: {
          latitude: Number(fix.latitude.toFixed(7)),
          longitude: Number(fix.longitude.toFixed(7)),
        },
      });
      note(
        index,
        `Đã lấy vị trí hiện tại (sai số khoảng ${Math.round(fix.accuracyMeters)} m). Bấm "Gắn vào đường gần nhất" để chọn graph node.`,
      );
    } catch (cause) {
      note(
        index,
        cause instanceof Error ? cause.message : 'Không lấy được vị trí.',
      );
    } finally {
      setBusyIndex(null);
    }
  }

  async function snapEntrance(index: number) {
    const entrance = draft.entrances[index];
    if (!entrance) return;
    setBusyIndex(index);
    note(index, '');
    try {
      const snap = nearestWalkNode(await loadWalkNodes(), entrance.location);
      if (!snap) {
        note(index, 'Chưa có dữ liệu đường đi để gắn.');
        return;
      }
      update(index, {
        graphNodeRef: snap.node.ref,
        location: { latitude: snap.node.lat, longitude: snap.node.lon },
      });
      const metres = Math.round(snap.distanceMeters);
      note(
        index,
        metres > MAX_SNAP_METERS
          ? `Đã gắn vào ${snap.node.ref}, nhưng cách ${metres} m: khá xa đường đi bộ, hãy kiểm tra lại vị trí.`
          : `Đã gắn vào ${snap.node.ref} (cách vị trí đã chọn ${metres} m).`,
      );
    } catch {
      note(index, 'Không tải được dữ liệu đường đi. Thử lại sau.');
    } finally {
      setBusyIndex(null);
    }
  }
  return (
    <div className="panel card">
      <div className="section-heading">
        <div>
          <h2>Cổng vào dẫn đường</h2>
          <p>Đích route là graph node của cổng, không phải tâm POI.</p>
        </div>
        <button
          className="button ghost"
          onClick={() =>
            setDraft({
              ...draft,
              entrances: [
                ...draft.entrances,
                {
                  labelVi: '',
                  labelEn: '',
                  location: { ...draft.location },
                  graphNodeRef: '',
                  isPrimary: false,
                  accessibility: 'standard',
                },
              ],
            })
          }
        >
          + Thêm cổng
        </button>
      </div>
      {errors.entrances && (
        <small className="field-error">{errors.entrances}</small>
      )}
      {draft.entrances.map((entrance, index) => (
        <div className="entrance-card" key={entrance.id ?? index}>
          <div className="repeat-row">
            <label>
              Tên VI
              <input
                value={entrance.labelVi}
                onChange={(e) => update(index, { labelVi: e.target.value })}
              />
              {errors[`entrances.${index}.labelVi`] && (
                <small className="field-error">
                  {errors[`entrances.${index}.labelVi`]}
                </small>
              )}
            </label>
            <label>
              Tên EN
              <input
                value={entrance.labelEn}
                onChange={(e) => update(index, { labelEn: e.target.value })}
              />
              {errors[`entrances.${index}.labelEn`] && (
                <small className="field-error">
                  {errors[`entrances.${index}.labelEn`]}
                </small>
              )}
            </label>
            <label>
              Graph node
              <input
                value={entrance.graphNodeRef}
                onChange={(e) =>
                  update(index, { graphNodeRef: e.target.value })
                }
              />
              {errors[`entrances.${index}.graphNodeRef`] && (
                <small className="field-error">
                  {errors[`entrances.${index}.graphNodeRef`]}
                </small>
              )}
            </label>
            <button
              aria-label="Xóa cổng"
              onClick={() =>
                setDraft({
                  ...draft,
                  entrances: draft.entrances.filter((_, i) => i !== index),
                })
              }
            >
              ×
            </button>
          </div>
          <div className="coords">
            <label>
              Vĩ độ
              <input
                type="number"
                step="any"
                value={entrance.location.latitude}
                onChange={(e) =>
                  update(index, {
                    location: {
                      ...entrance.location,
                      latitude: Number(e.target.value),
                    },
                  })
                }
              />
              {errors[`entrances.${index}.latitude`] && (
                <small className="field-error">
                  {errors[`entrances.${index}.latitude`]}
                </small>
              )}
            </label>
            <label>
              Kinh độ
              <input
                type="number"
                step="any"
                value={entrance.location.longitude}
                onChange={(e) =>
                  update(index, {
                    location: {
                      ...entrance.location,
                      longitude: Number(e.target.value),
                    },
                  })
                }
              />
              {errors[`entrances.${index}.longitude`] && (
                <small className="field-error">
                  {errors[`entrances.${index}.longitude`]}
                </small>
              )}
            </label>
          </div>
          <div className="geo-actions">
            <button
              type="button"
              className="button ghost small"
              disabled={busyIndex === index}
              onClick={() => void entranceFromDevice(index)}
            >
              📍 Dùng vị trí hiện tại
            </button>
            <button
              type="button"
              className="button ghost small"
              disabled={busyIndex === index}
              onClick={() => void snapEntrance(index)}
            >
              Gắn vào đường gần nhất
            </button>
            {notes[index] && (
              <small className="geo-note" role="status">
                {notes[index]}
              </small>
            )}
          </div>
          <div className="entrance-options">
            <label>
              <input
                type="radio"
                name="primaryEntrance"
                checked={entrance.isPrimary}
                onChange={() =>
                  setDraft({
                    ...draft,
                    entrances: draft.entrances.map((item, i) => ({
                      ...item,
                      isPrimary: i === index,
                    })),
                  })
                }
              />{' '}
              Cổng chính
            </label>
            <label>
              Tiếp cận
              <select
                value={entrance.accessibility}
                onChange={(e) =>
                  update(index, {
                    accessibility: e.target.value as 'standard' | 'step_free',
                  })
                }
              >
                <option value="standard">Tiêu chuẩn</option>
                <option value="step_free">Không bậc</option>
              </select>
            </label>
          </div>
        </div>
      ))}
    </div>
  );
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
