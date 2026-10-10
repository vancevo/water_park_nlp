'use client';

import type {
  NarrationLocaleCatalog,
  NarrationLocaleCode,
  PoiNarration,
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
import type { PlayerStatus } from '@/lib/narration-player';
import type { UiLocale, UiText } from '@/lib/ui-text';

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
export function useVisitorNarration(poiId: string | null, uiLocale: UiLocale) {
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
  t,
  catalog,
  catalogStatus,
  narrationLocale,
  narration,
  status,
  speechSupported,
  playback,
  onLocaleChange,
  onRetry,
  onRetryCatalog,
  onListen,
  onPause,
  onResume,
  onStop,
}: {
  t: UiText;
  catalog: NarrationLocaleCatalog;
  catalogStatus: CatalogStatus;
  narrationLocale: NarrationLocaleCode | null;
  narration: PoiNarration | null;
  status: NarrationStatus;
  speechSupported: boolean;
  /** State of the shared player for THIS place, and whether it was already heard. */
  playback: { status: PlayerStatus; heard: boolean };
  onLocaleChange(code: NarrationLocaleCode): void;
  onRetry(): void;
  onRetryCatalog(): void;
  onListen(): void;
  onPause(): void;
  onResume(): void;
  onStop(): void;
}) {
  const selectId = useId();
  const fallback = narrationFallbackNotice(catalog, narration);
  // The listen button sits next to the language select; with a fallback language the
  // body offers "listen in <language>" instead, so the row has no button.
  const canListen =
    narration !== null &&
    status === 'ready' &&
    !narration.fallbackUsed &&
    Boolean(narration.audio || speechSupported);
  return (
    <section className="narration" aria-label={t.narrationLabel}>
      <div className="narration-bar">
        <div className="narration-locale">
          <label htmlFor={selectId}>{t.narrationLanguage}</label>
          <select
            id={selectId}
            value={narrationLocale ?? ''}
            disabled={catalogStatus === 'loading' || !narrationLocale}
            aria-busy={catalogStatus === 'loading'}
            onChange={(event) => onLocaleChange(event.target.value)}
          >
            {catalogStatus === 'loading' && !narrationLocale ? (
              <option value="">{t.loadingLanguages}</option>
            ) : null}
            {catalog.locales.map((option) => (
              <option key={option.code} value={option.code} lang={option.code}>
                {option.nativeLabel}
              </option>
            ))}
          </select>
        </div>
        {narration && canListen ? (
          <ListenControls
            t={t}
            status={playback.status}
            heard={playback.heard}
            canPause={Boolean(narration.audio)}
            onListen={onListen}
            onPause={onPause}
            onResume={onResume}
            onStop={onStop}
          />
        ) : null}
      </div>
      {catalogStatus === 'error' ? (
        <p className="narration-note" role="status">
          {t.catalogError}{' '}
          <button
            type="button"
            className="inline-action"
            onClick={onRetryCatalog}
          >
            {t.retry}
          </button>
        </p>
      ) : null}
      {/* Only short status text is live; the transcript itself is not re-announced. */}
      <div className="narration-status" role="status" aria-live="polite">
        {status === 'loading' ? (
          <small className="muted">{t.loadingNarration}</small>
        ) : null}
        {status === 'missing' ? (
          <small className="muted">{t.noApprovedNarration}</small>
        ) : null}
        {fallback ? (
          <p className="fallback-notice">
            {t.noNarrationFor(fallback.requestedLabel, fallback.resolvedLabel)}
          </p>
        ) : null}
      </div>
      {status === 'error' ? (
        <p className="narration-note" role="alert">
          {t.narrationError}{' '}
          <button type="button" className="inline-action" onClick={onRetry}>
            {t.retry}
          </button>
        </p>
      ) : null}
      <div className="narration-body">
        {narration && status === 'ready' ? (
          <>
            <strong>
              {t.narrationTitle(localeLabel(catalog, narration.resolvedLocale))}
            </strong>
            <p lang={narration.resolvedLocale}>{narration.transcript}</p>
            {narration.fallbackUsed ? (
              // Never play another language under the chosen one: offer to switch.
              <button
                type="button"
                className="secondary-action"
                onClick={() => onLocaleChange(narration.resolvedLocale)}
              >
                {t.listenInLanguage(
                  localeLabel(catalog, narration.resolvedLocale),
                )}
              </button>
            ) : canListen ? null : (
              <small className="muted">{t.noAudioNoAutoRead}</small>
            )}
          </>
        ) : null}
      </div>
    </section>
  );
}

/** The card's buttons; the sound itself comes from the one shared player. */
function ListenControls({
  t,
  status,
  heard,
  canPause,
  onListen,
  onPause,
  onResume,
  onStop,
}: {
  t: UiText;
  status: PlayerStatus;
  heard: boolean;
  canPause: boolean;
  onListen(): void;
  onPause(): void;
  onResume(): void;
  onStop(): void;
}) {
  const stopButton = (
    <button
      type="button"
      className="secondary-action stop-action"
      onClick={onStop}
    >
      {t.stopAudio}
    </button>
  );
  if (status === 'loading' || status === 'playing') {
    return (
      <div className="listen-row">
        {/* A pulsing dot; the words stay for screen readers, the buttons say the rest. */}
        <span className="listening" role="status">
          <span className="sr-only">{t.listeningNow}</span>
        </span>
        {canPause && status === 'playing' ? (
          <button
            type="button"
            className="secondary-action pause-action"
            onClick={onPause}
          >
            {t.pauseAudio}
          </button>
        ) : null}
        {stopButton}
      </div>
    );
  }
  if (status === 'paused') {
    return (
      <div className="listen-row">
        <button
          type="button"
          className="secondary-action pause-action"
          onClick={onResume}
        >
          {t.resumeAudio}
        </button>
        {stopButton}
      </div>
    );
  }
  if (status === 'blocked') {
    return (
      <div className="listen-row">
        <button type="button" className="secondary-action" onClick={onListen}>
          {t.tapToListen}
        </button>
      </div>
    );
  }
  if (status === 'error') {
    return (
      <div className="listen-row">
        <small role="alert">{t.playbackFailed}</small>
        <button type="button" className="secondary-action" onClick={onListen}>
          {t.retry}
        </button>
      </div>
    );
  }
  return (
    <div className="listen-row">
      {heard ? <span className="heard-badge">{t.listened}</span> : null}
      <button type="button" className="secondary-action" onClick={onListen}>
        {heard ? t.listenAgain : t.listenNarration}
      </button>
    </div>
  );
}
