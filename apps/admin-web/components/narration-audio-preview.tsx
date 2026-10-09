'use client';

import type {
  AdminNarration,
  NarrationAudioPlayback,
} from '@damsen/shared-types';
import { useCallback, useEffect, useId, useState } from 'react';
import { narrationErrorMessage } from '@/lib/narration-admin-client';

type PlaybackState =
  | { status: 'loading' }
  | { status: 'ready'; url: string }
  | { status: 'error'; message: string };

/**
 * The narration's current audio, played through the v1.1 admin playback
 * endpoint (short-lived signed GET; draft audio is never public). Audio made by
 * a TTS job is labelled AI-generated with its `audioGeneratedBy` provenance so
 * the editor and reviewer know what they are approving.
 */
export function NarrationAudioPreview({
  narration,
  loadPlayback,
}: {
  narration: AdminNarration;
  loadPlayback: (id: string) => Promise<NarrationAudioPlayback>;
}) {
  const headingId = useId();
  const audio = narration.audio;
  const generatedBy = narration.audioGeneratedBy;
  const key = audio ? `${narration.id}|${audio.sha256}` : '';
  const [playback, setPlayback] = useState<PlaybackState & { key: string }>({
    status: 'loading',
    key: '',
  });

  const load = useCallback(async () => {
    if (!key) return;
    setPlayback({ status: 'loading', key });
    try {
      const { playbackUrl } = await loadPlayback(narration.id);
      setPlayback({ status: 'ready', url: playbackUrl, key });
    } catch (cause) {
      setPlayback({
        status: 'error',
        key,
        message: narrationErrorMessage(
          cause,
          'Không lấy được đường dẫn nghe thử audio.',
        ),
      });
    }
  }, [key, loadPlayback, narration.id]);

  useEffect(() => {
    // Signing is cheap and the URL is short-lived: fetch one per audio version.
    void load();
  }, [load]);

  if (!audio) return null;
  const current: PlaybackState =
    playback.key === key ? playback : { status: 'loading' };

  return (
    <section
      className={`audio-preview draft-audio${generatedBy ? ' ai-preview' : ''}`}
      aria-labelledby={headingId}
    >
      <b id={headingId}>
        {generatedBy && <span className="ai-badge">AI-generated</span>}{' '}
        {generatedBy
          ? 'Audio AI của phiên bản này'
          : 'Audio đính kèm phiên bản này'}
      </b>
      {current.status === 'loading' && (
        <small role="status">Đang lấy đường dẫn nghe thử…</small>
      )}
      {current.status === 'ready' && (
        <audio
          controls
          preload="metadata"
          src={current.url}
          lang={narration.locale}
          aria-labelledby={headingId}
          // The signed URL expires after ten minutes; offer a fresh one.
          onError={() =>
            setPlayback({
              status: 'error',
              key,
              message:
                'Không phát được audio (đường dẫn nghe thử có thể đã hết hạn).',
            })
          }
        />
      )}
      {current.status === 'error' && (
        <div className="alert error" role="alert">
          <span>{current.message}</span>
          <button
            type="button"
            className="link-button"
            onClick={() => void load()}
          >
            Lấy lại đường dẫn
          </button>
        </div>
      )}
      <small>
        {audio.mimeType} · {audio.durationSeconds.toFixed(1)} giây ·{' '}
        {(audio.sizeBytes / 1024).toFixed(0)} KiB
      </small>
      {generatedBy ? (
        <dl
          className="tts-provenance"
          aria-label="Nguồn gốc audio AI của phiên bản này"
        >
          <div>
            <dt>Nhà cung cấp</dt>
            <dd>{generatedBy.provider}</dd>
          </div>
          <div>
            <dt>Model</dt>
            <dd>
              {generatedBy.model} · {generatedBy.modelVersion}
            </dd>
          </div>
          <div>
            <dt>Giọng</dt>
            <dd>{generatedBy.voiceId}</dd>
          </div>
          <div>
            <dt>Giấy phép</dt>
            <dd>{generatedBy.license}</dd>
          </div>
          <div>
            <dt>Tạo lúc</dt>
            <dd>
              <time dateTime={generatedBy.generatedAt}>
                {new Date(generatedBy.generatedAt).toLocaleString('vi-VN')}
              </time>
            </dd>
          </div>
        </dl>
      ) : (
        <small>Quyền sử dụng: {audio.rightsOwner}</small>
      )}
    </section>
  );
}
