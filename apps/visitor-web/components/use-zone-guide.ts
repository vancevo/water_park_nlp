'use client';

import type { GeoPoint } from '@damsen/shared-types';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { narrationKey } from '@/lib/listen-history';
import type { NarrationPlayer, RequestResult } from '@/lib/narration-player';
import type { Zone } from '@/lib/zones';
import {
  nearestZone,
  resolveZone,
  zoneArrivingLine,
  zoneDistances,
  zoneHistoryId,
  zoneSpeech,
  zoneText,
  zoneWelcomeLine,
} from '@/lib/zones';

/** Further than this from every place: the visitor is not in the park. */
const IN_PARK_METERS = 300;
/** The zone a visitor is welcomed into, if one of its places is this close. */
const WELCOME_ZONE_METERS = 150;
/** A new zone must hold for this many 1 s ticks before it counts (a walker cuts corners). */
const STABLE_TICKS = 2;

export interface ZoneGuideState {
  /** The introduction that is being (or was just) spoken, shown as a card. */
  card: Zone | null;
  /** The "where do you want to go" box, with the zone the visitor was welcomed into. */
  welcome: { zone: Zone | null } | null;
}

/**
 * Zone introductions while auto narration is on: coming near a zone speaks what is there,
 * what to try and what to watch out for (once per language); switching auto narration on
 * (or coming back to the app) says which zone the visitor is in and asks what they want next.
 * It reads the visitor's position (real GPS or the simulated walker) every second, also
 * while the walker is walking.
 */
export function useZoneGuide({
  enabled,
  player,
  playerIdle,
  zones,
  places,
  narrationLocale,
  speechTag,
  welcomeTicket,
  readPosition,
  onNotInPark,
}: {
  enabled: boolean;
  player: NarrationPlayer | null;
  /** The shared player has nothing playing: a waiting introduction may start. */
  playerIdle: boolean;
  zones: readonly Zone[];
  places: readonly { slug: string; location: GeoPoint }[];
  narrationLocale: string | null;
  speechTag: string;
  /** Bumps whenever the welcome should run (auto narration switched on, app came back). */
  welcomeTicket: number;
  readPosition(): GeoPoint | null;
  onNotInPark(): void;
}): ZoneGuideState & {
  dismissCard(): void;
  dismissWelcome(): void;
  /** The visitor pressed Stop: an introduction that waited for the audio is dropped. */
  clearQueue(): void;
} {
  const [card, setCard] = useState<Zone | null>(null);
  const [welcome, setWelcome] = useState<{ zone: Zone | null } | null>(null);
  const locations = useMemo(
    () => new Map(places.map((place) => [place.slug, place.location])),
    [places],
  );
  const currentRef = useRef<string | null>(null);
  const candidateRef = useRef<{ id: string | null; ticks: number }>({
    id: null,
    ticks: 0,
  });
  const queuedRef = useRef<string | null>(null);
  const welcomePendingRef = useRef(false);
  const live = useRef({
    player,
    zones,
    locations,
    narrationLocale,
    speechTag,
    readPosition,
    onNotInPark,
  });
  live.current = {
    player,
    zones,
    locations,
    narrationLocale,
    speechTag,
    readPosition,
    onNotInPark,
  };

  const speak = useCallback(
    (zone: Zone | null, welcoming: boolean): Promise<RequestResult> => {
      const { player: p, narrationLocale: nl, speechTag: tag } = live.current;
      const locale = nl ?? 'vi';
      if (!p) return Promise.resolve('ignored');
      const name = zone ? zoneText(zone.name, locale) : '';
      const id = zone ? zoneHistoryId(zone.id) : 'zone:park';
      // An introduction is heard once per language; a welcome is asked again each time.
      const key = narrationKey(
        id,
        locale,
        welcoming ? `welcome-${Date.now()}` : 'v1',
      );
      const text = welcoming
        ? zoneWelcomeLine(locale, zone ? name : null)
        : zoneSpeech(zone!, locale, zoneArrivingLine(locale, name));
      // Automatic like the GPS: it never cuts into audio the visitor is listening to.
      return p.request({
        source: 'auto-gps',
        poiId: id,
        poiName: zone ? name : 'Đầm Sen',
        locale,
        load: () =>
          Promise.resolve({
            key,
            poiId: id,
            poiName: zone ? name : 'Đầm Sen',
            locale,
            audioUrl: null,
            text,
            speechLang: tag,
          }),
      });
    },
    [],
  );

  const announce = useCallback(
    (zone: Zone) => {
      void speak(zone, false).then((outcome) => {
        // The text shows at once; when other audio is playing the GPS never cuts into it, so
        // the introduction waits for it to end.
        if (outcome === 'played' || outcome === 'busy') setCard(zone);
        if (outcome === 'busy') queuedRef.current = zone.id;
      });
    },
    [speak],
  );

  // Off: forget the zone, so switching on again starts clean (the cards stay).
  useEffect(() => {
    if (enabled) return;
    currentRef.current = null;
    candidateRef.current = { id: null, ticks: 0 };
    queuedRef.current = null;
    welcomePendingRef.current = false;
    // The cards stay for the visitor to read; only the visitor closes them.
  }, [enabled]);

  useEffect(() => {
    if (enabled && welcomeTicket > 0) welcomePendingRef.current = true;
  }, [enabled, welcomeTicket]);

  useEffect(() => {
    if (!enabled) return;
    const tick = () => {
      const { zones: all, locations: where, readPosition: read } = live.current;
      if (all.length === 0 || where.size === 0) return;
      const position = read();
      if (!position) return;
      const distances = zoneDistances(position, all, where);

      if (welcomePendingRef.current) {
        welcomePendingRef.current = false;
        const nearest = nearestZone(distances);
        if (!nearest || nearest.distance > IN_PARK_METERS) {
          live.current.onNotInPark();
          return;
        }
        const zone =
          nearest.distance <= WELCOME_ZONE_METERS
            ? (all.find((item) => item.id === nearest.id) ?? null)
            : null;
        // The welcomed zone is "current": its introduction is not repeated on top of it.
        currentRef.current = nearest.distance <= 90 ? nearest.id : null;
        candidateRef.current = { id: null, ticks: 0 };
        queuedRef.current = null;
        setCard(null);
        setWelcome({ zone });
        void speak(zone, true);
        return;
      }

      const next = resolveZone(currentRef.current, distances);
      if (next === currentRef.current) {
        candidateRef.current = { id: null, ticks: 0 };
        return;
      }
      const candidate = candidateRef.current;
      candidateRef.current = {
        id: next,
        ticks: candidate.id === next ? candidate.ticks + 1 : 1,
      };
      if (candidateRef.current.ticks < STABLE_TICKS) return;
      candidateRef.current = { id: null, ticks: 0 };
      currentRef.current = next;
      queuedRef.current = null;
      const zone = next ? all.find((item) => item.id === next) : undefined;
      if (zone) announce(zone);
    };
    const timer = window.setInterval(tick, 1000);
    tick();
    return () => window.clearInterval(timer);
  }, [announce, enabled, speak]);

  // The audio ended: an introduction that waited gets its turn if the visitor is still there.
  useEffect(() => {
    if (!enabled || !playerIdle) return;
    const waiting = queuedRef.current;
    if (!waiting) return;
    queuedRef.current = null;
    if (currentRef.current !== waiting) return;
    const zone = live.current.zones.find((item) => item.id === waiting);
    if (zone) announce(zone);
  }, [announce, enabled, playerIdle]);

  return {
    card,
    welcome,
    dismissCard: useCallback(() => setCard(null), []),
    dismissWelcome: useCallback(() => setWelcome(null), []),
    clearQueue: useCallback(() => {
      queuedRef.current = null;
    }, []),
  };
}
