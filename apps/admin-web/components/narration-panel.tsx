'use client';

import type {
  AdminNarration,
  NarrationAudioMetadataInput,
  SupportedLocale,
} from '@damsen/shared-types';
import { useCallback, useEffect, useMemo, useState } from 'react';
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
  audioMetadata,
  sha256Hex,
  validateAudioFile,
} from '@/lib/narration-media';
import { StatusBadge } from './status-badge';

export function NarrationPanel({ poiId }: { poiId: string }) {
  const [locale, setLocale] = useState<SupportedLocale>('vi');
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

  const selected = newestNarration(items, locale);
  const revisions = useMemo(
    () =>
      items
        .filter((item) => item.locale === locale)
        .sort((a, b) => b.revision - a.revision),
    [items, locale],
  );

  return (
    <div className="panel card narration-panel">
      <div className="section-heading">
        <div>
          <h2>Thuyết minh và audio</h2>
          <p>Bản nháp, duyệt nội dung và tệp nghe theo từng ngôn ngữ.</p>
        </div>
        <span className="tag">≤ 50 MiB</span>
      </div>
      <div className="tabs">
        {(['vi', 'en'] as const).map((item) => (
          <button
            key={item}
            className={locale === item ? 'selected' : ''}
            onClick={() => {
              setLocale(item);
              setGeneration(0);
            }}
          >
            {item === 'vi' ? '🇻🇳 Tiếng Việt' : '🇬🇧 English'}
          </button>
        ))}
      </div>
      {!session && (
        <div className="alert error">
          Đăng nhập phiên quản trị để xem và cập nhật thuyết minh.
        </div>
      )}
      {loading && <div className="empty-inline">Đang tải thuyết minh…</div>}
      {error && (
        <div className="alert error">
          {error}{' '}
          <button className="link-button" onClick={() => void load()}>
            Thử lại
          </button>
        </div>
      )}
      {!loading && !error && session && (
        <NarrationEditor
          key={`${locale}:${selected?.id ?? 'new'}:${generation}`}
          poiId={poiId}
          locale={locale}
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
      {revisions.length > 0 && (
        <div className="narration-history">
          <h3>Lịch sử phiên bản</h3>
          {revisions.map((item) => (
            <div className="narration-revision" key={item.id}>
              <span>Phiên bản {item.revision}</span>
              <StatusBadge status={item.status} />
              <small>{new Date(item.updatedAt).toLocaleString('vi-VN')}</small>
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
    </div>
  );
}

function NarrationEditor({
  poiId,
  locale,
  current,
  permissions,
  onChanged,
  startNew,
  onStartNew,
}: {
  poiId: string;
  locale: SupportedLocale;
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
            {isNew ? 'Bản thuyết minh mới' : `Phiên bản ${current.revision}`}
          </h3>
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
        <div className={message.includes('Không') ? 'alert error' : 'alert'}>
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
