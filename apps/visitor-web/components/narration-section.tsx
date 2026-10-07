'use client';

import type {
  NarrationLocaleCatalog,
  NarrationLocaleCode,
  PoiNarration,
  SupportedLocale,
} from '@damsen/shared-types';
import { useCallback, useEffect, useId, useState } from 'react';
import {
  OFFLINE_NARRATION_LOCALE_CATALOG,
  localeLabel,
  narrationFallbackNotice,
  readNarrationLocalePreference,
  resolveInitialNarrationLocale,
  saveNarrationLocalePreference,
} from '@/lib/narration-locales';
import { getNarrationPorts } from '@/lib/narration-source';

export type CatalogStatus = 'loading' | 'ready' | 'error';
export type NarrationStatus =
  | 'idle'
  | 'loading'
  | 'ready'
  | 'missing'
  | 'error';

/**
 * Narration locale + narration content for the selected POI. The narration
 * locale is independent of the UI locale: it comes from the catalog, is
 * remembered in localStorage and only falls back to the UI locale initially.
 */
export function useVisitorNarration(
  poiId: string | null,
  uiLocale: SupportedLocale,
) {
  const [catalogStatus, setCatalogStatus] = useState<CatalogStatus>('loading');
  const [catalog, setCatalog] = useState<NarrationLocaleCatalog>(
    OFFLINE_NARRATION_LOCALE_CATALOG,
  );
  const [narrationLocale, setNarrationLocaleState] =
    useState<NarrationLocaleCode | null>(null);
  const [narration, setNarration] = useState<PoiNarration | null>(null);
  const [status, setStatus] = useState<NarrationStatus>('idle');
  const [attempt, setAttempt] = useState(0);

  const loadCatalog = useCallback(async () => {
    setCatalogStatus('loading');
    let next = OFFLINE_NARRATION_LOCALE_CATALOG;
    let ok = false;
    try {
      next = await getNarrationPorts().catalog.getCatalog();
      ok = next.locales.length > 0;
      if (!ok) next = OFFLINE_NARRATION_LOCALE_CATALOG;
    } catch {
      // Keep transcripts usable with the built-in VI/EN catalog.
    }
    setCatalog(next);
    setCatalogStatus(ok ? 'ready' : 'error');
    setNarrationLocaleState((current) =>
      current && next.locales.some((option) => option.code === current)
        ? current
        : resolveInitialNarrationLocale(
            next,
            readNarrationLocalePreference(),
            uiLocale,
          ),
    );
    // uiLocale only seeds the very first choice; later UI switches never
    // change the narration locale.
  }, []);
  useEffect(() => {
    void loadCatalog();
  }, [loadCatalog]);

  const setNarrationLocale = useCallback((code: NarrationLocaleCode) => {
    setNarrationLocaleState(code);
    saveNarrationLocalePreference(code);
  }, []);

  useEffect(() => {
    setNarration(null);
    if (!poiId || !narrationLocale) {
      setStatus('idle');
      return;
    }
    let cancelled = false;
    setStatus('loading');
    getNarrationPorts()
      .narration.getNarration(poiId, narrationLocale)
      .then((next) => {
        if (cancelled) return;
        setNarration(next);
        setStatus('ready');
      })
      .catch((cause: unknown) => {
        if (cancelled) return;
        const notFound =
          typeof cause === 'object' &&
          cause !== null &&
          'status' in cause &&
          (cause as { status: unknown }).status === 404;
        setStatus(notFound ? 'missing' : 'error');
      });
    return () => {
      cancelled = true;
    };
  }, [poiId, narrationLocale, attempt]);

  return {
    catalog,
    catalogStatus,
    narrationLocale,
    setNarrationLocale,
    narration,
    status,
    retry: () => setAttempt((value) => value + 1),
    retryCatalog: () => void loadCatalog(),
  };
}

export function NarrationSection({
  catalog,
  catalogStatus,
  narrationLocale,
  narration,
  status,
  speechSupported,
  onLocaleChange,
  onRetry,
  onRetryCatalog,
  onSpeak,
}: {
  catalog: NarrationLocaleCatalog;
  catalogStatus: CatalogStatus;
  narrationLocale: NarrationLocaleCode | null;
  narration: PoiNarration | null;
  status: NarrationStatus;
  speechSupported: boolean;
  onLocaleChange(code: NarrationLocaleCode): void;
  onRetry(): void;
  onRetryCatalog(): void;
  onSpeak(): void;
}) {
  const selectId = useId();
  const fallback = narrationFallbackNotice(catalog, narration);
  return (
    <section className="narration" aria-label="Thuyết minh">
      <div className="narration-locale">
        <label htmlFor={selectId}>Ngôn ngữ thuyết minh</label>
        <select
          id={selectId}
          value={narrationLocale ?? ''}
          disabled={catalogStatus === 'loading' || !narrationLocale}
          aria-busy={catalogStatus === 'loading'}
          onChange={(event) => onLocaleChange(event.target.value)}
        >
          {catalogStatus === 'loading' && !narrationLocale ? (
            <option value="">Đang tải ngôn ngữ…</option>
          ) : null}
          {catalog.locales.map((option) => (
            <option key={option.code} value={option.code} lang={option.code}>
              {option.nativeLabel}
            </option>
          ))}
        </select>
      </div>
      {catalogStatus === 'error' ? (
        <p className="narration-note" role="status">
          Không tải được danh sách ngôn ngữ; đang dùng Tiếng Việt/English.{' '}
          <button
            type="button"
            className="inline-action"
            onClick={onRetryCatalog}
          >
            Thử lại
          </button>
        </p>
      ) : null}
      <div aria-live="polite" className="narration-body">
        {status === 'loading' ? (
          <small className="muted">Đang tải thuyết minh…</small>
        ) : null}
        {status === 'missing' ? (
          <small className="muted">
            Địa điểm này chưa có bản thuyết minh được duyệt.
          </small>
        ) : null}
        {status === 'error' ? (
          <p className="narration-note" role="alert">
            Không tải được thuyết minh.{' '}
            <button type="button" className="inline-action" onClick={onRetry}>
              Thử lại
            </button>
          </p>
        ) : null}
        {fallback ? (
          <p className="fallback-notice" role="status">
            Chưa có thuyết minh {fallback.requestedLabel}; đang hiển thị bản{' '}
            {fallback.resolvedLabel}.
          </p>
        ) : null}
        {narration && status === 'ready' ? (
          <>
            <strong>
              Thuyết minh · {localeLabel(catalog, narration.resolvedLocale)}
            </strong>
            <p lang={narration.resolvedLocale}>{narration.transcript}</p>
            {narration.audio ? (
              <audio
                controls
                preload="none"
                src={narration.audio.playbackUrl}
                aria-label={`Audio thuyết minh ${localeLabel(catalog, narration.resolvedLocale)}`}
              />
            ) : speechSupported ? (
              <button
                type="button"
                className="secondary-action"
                onClick={onSpeak}
              >
                ▶ Đọc bằng giọng của trình duyệt
              </button>
            ) : (
              <small className="muted">
                Chưa có audio thu sẵn và trình duyệt không hỗ trợ đọc tự động;
                bạn vẫn có thể đọc nội dung ở trên.
              </small>
            )}
          </>
        ) : null}
      </div>
    </section>
  );
}
