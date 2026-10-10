'use client';

import type { NextStopKind } from '@/lib/next-stop';
import { NEXT_STOP_KINDS } from '@/lib/next-stop';
import type { UiLocale, UiText } from '@/lib/ui-text';
import type { Zone } from '@/lib/zones';
import { zoneText } from '@/lib/zones';

/** "Listening" with a Stop button, while the zone's audio is on. */
function SpeakingBar({ t, onStop }: { t: UiText; onStop(): void }) {
  return (
    <div className="zone-speaking" role="status">
      <span className="zone-speaking-label">
        <span className="zone-speaking-dot" aria-hidden="true" />
        {t.listeningNow}
      </span>
      <button type="button" className="zone-stop" onClick={onStop}>
        {t.stopAudio}
      </button>
    </div>
  );
}

/** The introduction of the zone the visitor is coming to: what is there, what to try, tips. */
export function ZoneCard({
  t,
  locale,
  zone,
  speaking,
  onStop,
  onClose,
}: {
  t: UiText;
  locale: UiLocale;
  zone: Zone;
  speaking: boolean;
  onStop(): void;
  onClose(): void;
}) {
  return (
    <aside className="zone-card" aria-label={t.zoneCardLabel}>
      <button
        type="button"
        className="close-button"
        onClick={onClose}
        aria-label={t.zoneClose}
      >
        ×
      </button>
      <p className="eyebrow">{t.zoneCardLabel}</p>
      <h3>{zoneText(zone.name, locale)}</h3>
      {speaking ? <SpeakingBar t={t} onStop={onStop} /> : null}
      <dl>
        <dt>{t.zoneHere}</dt>
        <dd>{zoneText(zone.intro, locale)}</dd>
        <dt>{t.zoneTry}</dt>
        <dd>{zoneText(zone.try, locale)}</dd>
        <dt>{t.zoneTip}</dt>
        <dd>{zoneText(zone.tip, locale)}</dd>
      </dl>
    </aside>
  );
}

const NEXT_ICONS: Record<NextStopKind, string> = {
  eat: '🍜',
  toilet: '🚻',
  rest: '☕',
  play: '🎢',
  home: '🚪',
};

/** "Where are you, what do you want to do?": the five things a visitor usually wants next. */
export function NextStopBox({
  t,
  locale,
  zone,
  speaking,
  onStop,
  onChoose,
  onClose,
}: {
  t: UiText;
  locale: UiLocale;
  zone: Zone | null;
  speaking: boolean;
  onStop(): void;
  onChoose(kind: NextStopKind): void;
  onClose(): void;
}) {
  const labels: Record<NextStopKind, string> = {
    eat: t.nextEat,
    toilet: t.nextToilet,
    rest: t.nextRest,
    play: t.nextPlay,
    home: t.nextHome,
  };
  return (
    <section className="next-stop" role="dialog" aria-label={t.nextQuestion}>
      <button
        type="button"
        className="close-button"
        onClick={onClose}
        aria-label={t.zoneClose}
      >
        ×
      </button>
      <h3>{t.nextTitle(zone ? zoneText(zone.name, locale) : null)}</h3>
      {speaking ? <SpeakingBar t={t} onStop={onStop} /> : null}
      <p>{t.nextQuestion}</p>
      <div className="next-stop-options">
        {NEXT_STOP_KINDS.map((kind) => (
          <button key={kind} type="button" onClick={() => onChoose(kind)}>
            <span aria-hidden="true">{NEXT_ICONS[kind]}</span>
            {labels[kind]}
          </button>
        ))}
      </div>
    </section>
  );
}

/**
 * What is being narrated right now, pinned to the top of the panel: the place, a Stop button
 * (and Pause/Resume for audio files), and a way to open the place's card.
 */
export function NowPlayingCard({
  t,
  name,
  status,
  canPause,
  onPause,
  onResume,
  onStop,
  onOpen,
}: {
  t: UiText;
  name: string;
  status: 'loading' | 'playing' | 'paused';
  canPause: boolean;
  onPause(): void;
  onResume(): void;
  onStop(): void;
  onOpen: (() => void) | undefined;
}) {
  return (
    <section className="now-playing" role="status" aria-label={t.audioBarLabel}>
      <span className="zone-speaking-dot" aria-hidden="true" />
      <span className="now-playing-name">
        <small>{status === 'paused' ? t.resumeAudio : t.listeningNow}</small>
        {onOpen ? (
          <button type="button" className="now-playing-open" onClick={onOpen}>
            {name}
          </button>
        ) : (
          <strong>{name}</strong>
        )}
      </span>
      {canPause && status === 'playing' ? (
        <button type="button" className="now-playing-button" onClick={onPause}>
          {t.pauseAudio}
        </button>
      ) : null}
      {status === 'paused' ? (
        <button type="button" className="now-playing-button" onClick={onResume}>
          {t.resumeAudio}
        </button>
      ) : null}
      <button type="button" className="zone-stop" onClick={onStop}>
        {t.stopAudio}
      </button>
    </section>
  );
}
