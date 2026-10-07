'use client';

import type {
  AdminNarration,
  NarrationAudioMetadataInput,
  NarrationLocaleCatalog,
  NarrationLocaleCode,
  NarrationLocaleOption,
} from '@damsen/shared-types';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import {
  AUTH_SESSION_EVENT,
  readAuthSession,
  type AdminAuthSession,
} from '@/lib/auth-session';
import {
  narrationAdminClient,
  narrationPermissions,
  newestNarration,
} from '@/lib/narration-admin-client';
import {
  disabledStoredLocales,
  getNarrationLocalePort,
  localeLabel,
} from '@/lib/narration-locales';
import {
  audioMetadata,
  sha256Hex,
  validateAudioFile,
} from '@/lib/narration-media';
import { StatusBadge } from './status-badge';

type CatalogState =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; catalog: NarrationLocaleCatalog };

function useNarrationLocaleCatalog() {
  const [state, setState] = useState<CatalogState>({ status: 'loading' });
  const load = useCallback(async () => {
    setState({ status: 'loading' });
    try {
      setState({
        status: 'ready',
        catalog: await getNarrationLocalePort().getCatalog(),
      });
    } catch (cause) {
      setState({
        status: 'error',
        message:
          cause instanceof Error
            ? cause.message
            : 'Không thể tải danh sách ngôn ngữ thuyết minh.',
      });
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);
  return { state, reload: load };
}

export function NarrationPanel({ poiId }: { poiId: string }) {
  const { state: catalogState, reload: reloadCatalog } =
    useNarrationLocaleCatalog();
  const catalog = catalogState.status === 'ready' ? catalogState.catalog : null;
  const [requestedLocale, setRequestedLocale] =
    useState<NarrationLocaleCode | null>(null);
  const [items, setItems] = useState<AdminNarration[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [generation, setGeneration] = useState(0);
  const [session, setSession] = useState<AdminAuthSession | null>(null);
  useEffect(() => {
    const sync = () => setSession(readAuthSession());
    sync();
    window.addEventListener(AUTH_SESSION_EVENT, sync);
    return () => window.removeEventListener(AUTH_SESSION_EVENT, sync);
  }, []);
  const permissions = narrationPermissions(session?.user.roles ?? []);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      setItems(await narrationAdminClient.list(poiId));
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : 'Không thể tải các bản thuyết minh.',
      );
    } finally {
      setLoading(false);
    }
  }, [poiId]);
  useEffect(() => {
    void load();
  }, [load]);

  // A locale disabled in config disappears after reload; fall back to default.
  const locale =
    catalog && catalog.locales.some((option) => option.code === requestedLocale)
      ? requestedLocale
      : (catalog?.defaultLocale ?? null);
  const localeOption = catalog?.locales.find((item) => item.code === locale);
  const selected = locale ? newestNarration(items, locale) : undefined;
  const revisions = useMemo(
    () =>
      items
        .filter((item) => item.locale === locale)
        .sort((a, b) => b.revision - a.revision),
    [items, locale],
  );
  const hiddenLocales = catalog ? disabledStoredLocales(catalog, items) : [];

  return (
    <section
      className="panel card narration-panel"
      aria-labelledby="narration-panel-title"
    >
      <div className="section-heading">
        <div>
          <h2 id="narration-panel-title">Thuyết minh và audio</h2>
          <p>
            Bản nháp, duyệt nội dung và tệp nghe theo từng ngôn ngữ được bật
            trong cấu hình.
          </p>
        </div>
        <span className="tag">≤ 50 MiB</span>
      </div>
      {catalogState.status === 'loading' && (
        <div className="empty-inline" role="status">
          Đang tải danh sách ngôn ngữ thuyết minh…
        </div>
      )}
      {catalogState.status === 'error' && (
        <div className="alert error" role="alert">
          <span>Không tải được danh sách ngôn ngữ: {catalogState.message}</span>
          <button className="link-button" onClick={() => void reloadCatalog()}>
            Thử lại
          </button>
        </div>
      )}
      {catalog && catalog.locales.length === 0 && (
        <div className="empty-inline" role="status">
          Chưa có ngôn ngữ thuyết minh nào được bật trong cấu hình.
        </div>
      )}
      {catalog && catalog.locales.length > 0 && locale && (
        <LocaleTabs
          catalog={catalog}
          selected={locale}
          items={items}
          disabled={!session}
          onSelect={(code) => {
            setRequestedLocale(code);
            setGeneration(0);
          }}
        />
      )}
      {hiddenLocales.length > 0 && (
        <p className="helper">
          Có bản thuyết minh ở ngôn ngữ đang tắt (
          {hiddenLocales.map((code) => code.toUpperCase()).join(', ')}). Nội
          dung vẫn được giữ nhưng không hiển thị cho khách cho đến khi bật lại.
        </p>
      )}
      {!session && (
        <div className="alert error">
          Đăng nhập phiên quản trị để xem và cập nhật thuyết minh.
        </div>
      )}
      <div
        id="narration-locale-panel"
        role={locale ? 'tabpanel' : undefined}
        aria-labelledby={locale ? `narration-tab-${locale}` : undefined}
        className="narration-locale-panel"
      >
        {loading && session && (
          <div className="empty-inline" role="status">
            Đang tải thuyết minh…
          </div>
        )}
        {error && (
          <div className="alert error" role="alert">
            <span>{error}</span>
            <button className="link-button" onClick={() => void load()}>
              Thử lại
            </button>
          </div>
        )}
        {!loading && !error && session && locale && localeOption && (
          <NarrationEditor
            key={`${locale}:${selected?.id ?? 'new'}:${generation}`}
            poiId={poiId}
            locale={locale}
            localeOption={localeOption}
            fallbackLabel={
              localeOption.fallbackLocale
                ? localeLabel(catalog, localeOption.fallbackLocale)
                : ''
            }
            current={selected}
            permissions={permissions}
            onChanged={async () => {
              setGeneration(0);
              await load();
            }}
            startNew={generation > 0}
            onStartNew={() => setGeneration((value) => value + 1)}
          />
        )}
        {revisions.length > 0 && localeOption && (
          <div className="narration-history">
            <h3>Lịch sử phiên bản · {localeOption.nativeLabel}</h3>
            {revisions.map((item) => (
              <div className="narration-revision" key={item.id}>
                <span>Phiên bản {item.revision}</span>
                <StatusBadge status={item.status} />
                <small>
                  {new Date(item.updatedAt).toLocaleString('vi-VN')}
                </small>
                <small>{item.audio ? 'Có audio' : 'Chỉ văn bản'}</small>
                {item.rejectionReason && (
                  <small className="field-error">
                    Lý do: {item.rejectionReason}
                  </small>
                )}
              </div>
            ))}
          </div>
        )}
        {!loading &&
          !error &&
          session &&
          localeOption &&
          revisions.length === 0 && (
            <p className="helper">
              Chưa có phiên bản {localeOption.nativeLabel} nào cho điểm này.
            </p>
          )}
      </div>
    </section>
  );
}

const STATUS_HINTS: Record<AdminNarration['status'], string> = {
  draft: 'Nháp',
  pending_review: 'Chờ duyệt',
  published: 'Đã xuất bản',
  rejected: 'Bị từ chối',
  superseded: 'Đã thay thế',
};

/** WAI-ARIA tabs with roving tabindex: Arrow/Home/End move focus and selection. */
function LocaleTabs({
  catalog,
  selected,
  items,
  disabled,
  onSelect,
}: {
  catalog: NarrationLocaleCatalog;
  selected: NarrationLocaleCode;
  items: AdminNarration[];
  disabled: boolean;
  onSelect(code: NarrationLocaleCode): void;
}) {
  const refs = useRef(new Map<string, HTMLButtonElement>());
  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const codes = catalog.locales.map((option) => option.code);
    const index = codes.indexOf(selected);
    const next =
      event.key === 'ArrowRight'
        ? codes[(index + 1) % codes.length]
        : event.key === 'ArrowLeft'
          ? codes[(index - 1 + codes.length) % codes.length]
          : event.key === 'Home'
            ? codes[0]
            : event.key === 'End'
              ? codes[codes.length - 1]
              : undefined;
    if (!next || disabled) return;
    event.preventDefault();
    onSelect(next);
    refs.current.get(next)?.focus();
  }
  return (
    <div
      className="tabs locale-tabs"
      role="tablist"
      aria-label="Ngôn ngữ thuyết minh"
      onKeyDown={onKeyDown}
    >
      {catalog.locales.map((option: NarrationLocaleOption) => {
        const newest = newestNarration(items, option.code);
        const isSelected = option.code === selected;
        return (
          <button
            key={option.code}
            id={`narration-tab-${option.code}`}
            ref={(node) => {
              if (node) refs.current.set(option.code, node);
              else refs.current.delete(option.code);
            }}
            type="button"
            role="tab"
            lang={option.code}
            aria-selected={isSelected}
            aria-controls="narration-locale-panel"
            tabIndex={isSelected ? 0 : -1}
            disabled={disabled}
            className={isSelected ? 'selected' : ''}
            onClick={() => onSelect(option.code)}
          >
            <span>{option.nativeLabel}</span>{' '}
            <small className="locale-code">{option.code.toUpperCase()}</small>
            <small className="locale-state">
              {newest ? STATUS_HINTS[newest.status] : 'Chưa có'}
            </small>
          </button>
        );
      })}
    </div>
  );
}

function NarrationEditor({
  poiId,
  locale,
  localeOption,
  fallbackLabel,
  current,
  permissions,
  onChanged,
  startNew,
  onStartNew,
}: {
  poiId: string;
  locale: NarrationLocaleCode;
  localeOption: NarrationLocaleOption;
  fallbackLabel: string;
  current?: AdminNarration;
  permissions: ReturnType<typeof narrationPermissions>;
  onChanged: () => Promise<void>;
  startNew: boolean;
  onStartNew: () => void;
}) {
  const isNew = !current || startNew;
  const editable =
    permissions.canEdit &&
    (isNew || current?.status === 'draft' || current?.status === 'rejected');
  const [transcript, setTranscript] = useState(current?.transcript ?? '');
  const [file, setFile] = useState<File>();
  const [previewUrl, setPreviewUrl] = useState('');
  const [durationSeconds, setDurationSeconds] = useState(0);
  const [rightsOwner, setRightsOwner] = useState('');
  const [rightsSource, setRightsSource] = useState('');
  const [usageRights, setUsageRights] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const hasUnsavedChanges =
    transcript.trim() !== (current?.transcript ?? '').trim() || Boolean(file);

  useEffect(
    () => () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    },
    [previewUrl],
  );

  function selectFile(selected?: File) {
    setMessage('');
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl('');
    setFile(undefined);
    setDurationSeconds(0);
    if (!selected) return;
    const validation = validateAudioFile(selected);
    if (validation) {
      setMessage(validation);
      return;
    }
    setFile(selected);
    setPreviewUrl(URL.createObjectURL(selected));
  }

  async function save() {
    const cleanTranscript = transcript.trim();
    if (cleanTranscript.length < 20 || cleanTranscript.length > 20_000) {
      setMessage('Nội dung phải từ 20 đến 20.000 ký tự.');
      return;
    }
    if (
      file &&
      (!(durationSeconds >= 0.001 && durationSeconds <= 1800) ||
        !rightsOwner.trim() ||
        !rightsSource.trim() ||
        !usageRights.trim())
    ) {
      setMessage('Audio cần thời lượng và đầy đủ thông tin quyền sử dụng.');
      return;
    }
    setBusy(true);
    setMessage(file ? 'Đang băm và tải audio…' : 'Đang lưu nội dung…');
    try {
      let audio: NarrationAudioMetadataInput | undefined;
      if (file) {
        const sha256 = await sha256Hex(file);
        const intent = await narrationAdminClient.uploadAudio(
          {
            poiId,
            locale,
            mimeType: file.type as NarrationAudioMetadataInput['mimeType'],
            sizeBytes: file.size,
            sha256,
          },
          file,
        );
        audio = audioMetadata(intent, file, sha256, durationSeconds, {
          rightsOwner,
          rightsSource,
          usageRights,
        });
      }
      if (isNew) {
        await narrationAdminClient.create(poiId, {
          locale,
          transcript: cleanTranscript,
          ...(audio ? { audio } : {}),
        });
      } else {
        await narrationAdminClient.update(current.id, {
          transcript: cleanTranscript,
          ...(audio ? { audio } : {}),
        });
      }
      setMessage('Đã lưu bản thuyết minh.');
      await onChanged();
    } catch (cause) {
      setMessage(cause instanceof Error ? cause.message : 'Không thể lưu.');
    } finally {
      setBusy(false);
    }
  }

  async function workflow(action: 'submit' | 'approve' | 'reject') {
    if (!current || startNew) return;
    let reason = '';
    if (action === 'reject') {
      reason = window.prompt('Lý do từ chối (ít nhất 3 ký tự):')?.trim() ?? '';
      if (reason.length < 3) return;
    }
    setBusy(true);
    setMessage('Đang cập nhật workflow…');
    try {
      if (action === 'submit') await narrationAdminClient.submit(current.id);
      else if (action === 'approve')
        await narrationAdminClient.approve(current.id);
      else await narrationAdminClient.reject(current.id, reason);
      setMessage('Workflow đã được cập nhật.');
      await onChanged();
    } catch (cause) {
      setMessage(
        cause instanceof Error ? cause.message : 'Không thể cập nhật workflow.',
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="narration-editor">
      <div className="section-heading">
        <div>
          <h3>
            {isNew ? 'Bản thuyết minh mới' : `Phiên bản ${current.revision}`} ·{' '}
            {localeOption.nativeLabel}
          </h3>
          {fallbackLabel && (
            <p className="helper">
              Ngôn ngữ dự phòng cho khách: {fallbackLabel} (dùng khi
              {localeOption.nativeLabel} chưa có bản xuất bản).
            </p>
          )}
          <p>
            {editable
              ? 'Bạn có thể lưu nháp và nghe thử audio trước khi gửi duyệt.'
              : 'Phiên bản này chỉ đọc ở trạng thái hiện tại.'}
          </p>
        </div>
        {current && !startNew && <StatusBadge status={current.status} />}
      </div>
      <label>
        Nội dung thuyết minh
        <textarea
          rows={8}
          lang={locale}
          minLength={20}
          maxLength={20_000}
          disabled={!editable || busy}
          value={transcript}
          onChange={(event) => setTranscript(event.target.value)}
        />
        <small>{transcript.trim().length}/20.000 ký tự</small>
      </label>
      {editable && (
        <div className="audio-upload-grid">
          <label className="audio-file">
            Audio MP3, M4A, OGG hoặc WAV
            <input
              type="file"
              accept="audio/mpeg,audio/mp4,audio/ogg,audio/wav"
              disabled={busy}
              onChange={(event) => selectFile(event.target.files?.[0])}
            />
          </label>
          {previewUrl && (
            <div className="audio-preview">
              <b>Nghe thử cục bộ trước khi xuất bản</b>
              <audio
                controls
                src={previewUrl}
                onLoadedMetadata={(event) =>
                  setDurationSeconds(event.currentTarget.duration)
                }
              />
              <small>
                {file?.name} · {durationSeconds.toFixed(1)} giây
              </small>
            </div>
          )}
          {file && (
            <>
              <label>
                Chủ sở hữu quyền
                <input
                  value={rightsOwner}
                  maxLength={500}
                  onChange={(event) => setRightsOwner(event.target.value)}
                />
              </label>
              <label>
                Nguồn nội dung
                <input
                  value={rightsSource}
                  maxLength={1000}
                  onChange={(event) => setRightsSource(event.target.value)}
                />
              </label>
              <label className="full-width">
                Phạm vi/quyền sử dụng
                <textarea
                  rows={2}
                  value={usageRights}
                  maxLength={1000}
                  onChange={(event) => setUsageRights(event.target.value)}
                />
              </label>
            </>
          )}
        </div>
      )}
      {current?.audio && !file && (
        <p className="helper">Phiên bản hiện tại đã đính kèm audio.</p>
      )}
      {message && (
        <div
          className={message.includes('Không') ? 'alert error' : 'alert'}
          role="status"
          aria-live="polite"
        >
          {message}
        </div>
      )}
      <div className="button-row narration-actions">
        {editable && (
          <button className="button primary" disabled={busy} onClick={save}>
            {busy ? 'Đang xử lý…' : 'Lưu thuyết minh'}
          </button>
        )}
        {!startNew && current?.status === 'draft' && permissions.canEdit && (
          <button
            className="button ghost"
            disabled={busy || hasUnsavedChanges}
            title={
              hasUnsavedChanges
                ? 'Lưu các thay đổi trước khi gửi duyệt.'
                : undefined
            }
            onClick={() => void workflow('submit')}
          >
            Gửi duyệt
          </button>
        )}
        {!startNew &&
          current?.status === 'pending_review' &&
          permissions.canReview && (
            <>
              <button
                className="button primary"
                disabled={busy}
                onClick={() => void workflow('approve')}
              >
                Duyệt xuất bản
              </button>
              <button
                className="button danger"
                disabled={busy}
                onClick={() => void workflow('reject')}
              >
                Từ chối
              </button>
            </>
          )}
        {!startNew &&
          current &&
          ['published', 'superseded'].includes(current.status) &&
          permissions.canEdit && (
            <button className="button ghost" onClick={onStartNew}>
              Tạo phiên bản mới
            </button>
          )}
      </div>
    </div>
  );
}
