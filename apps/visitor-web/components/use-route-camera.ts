'use client';

import type { GeoPoint, RouteResponse } from '@damsen/shared-types';
import type { Map as MapLibreMap } from 'maplibre-gl';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
} from 'react';
import { insetsFromRects, type Insets } from '@/lib/camera-insets';
import {
  EMPTY_WATCH,
  FOLLOW_DEFAULTS,
  boundsOf,
  buildRouteIndex,
  followWindow,
  holdFor,
  isUsableFix,
  pointAt,
  projectOnRoute,
  sliceRoute,
  steadyProgress,
  type WatchState,
} from '@/lib/route-follow';
import { geoDistanceMeters } from '@/lib/route-simulation';

/**
 * The single owner of the camera while a route is active.
 * - explore: no route, the camera belongs to the rest of the app (fit a place, locate…).
 * - follow:  the visitor and the next 80–150 m of the route stay in view.
 * - overview: the whole route, framed once; GPS ticks do not pull the camera back.
 * - free:    the visitor dragged / zoomed / rotated; only "Follow me" takes it back.
 * - arrived: the area of the destination; no more automatic camera moves.
 */
export type CameraMode = 'explore' | 'follow' | 'overview' | 'free' | 'arrived';

export interface RouteProgressInfo {
  distanceAlong: number;
  remainingMeters: number;
  lateralMeters: number;
}

const MIN_ZOOM = 16.5;
const MAX_ZOOM = 18.6;
/** Never zoom the whole-route view closer than this, however short the route. */
const OVERVIEW_MAX_ZOOM = 17.8;
/** A walking visitor leaves the first whole-route view for follow after this much progress. */
const AUTO_FOLLOW_METERS = 25;
/** The whole-route view keeps both ends clear of the map's edge. */
const OVERVIEW_MIN_PADDING = 64;
const roomy = (insets: Insets): Insets => ({
  top: Math.max(insets.top, OVERVIEW_MIN_PADDING),
  right: Math.max(insets.right, OVERVIEW_MIN_PADDING),
  bottom: Math.max(insets.bottom, OVERVIEW_MIN_PADDING),
  left: Math.max(insets.left, OVERVIEW_MIN_PADDING),
});
/** Camera commands are at least this far apart (ms); a trailing one catches the last position. */
const MIN_MOVE_INTERVAL_MS = 500;
const MOVE_DURATION_MS = 450;
/** The overlays that may cover the map and so must not hide the visitor or the road ahead. */
const OVERLAY_SELECTORS = [
  '.poi-detail',
  '.simulation-body',
  '.camera-controls',
];

export function useRouteCamera({
  mapRef,
  containerRef,
  mapReady,
  route,
  source,
  gpsPoint,
  gpsAccuracyMeters,
  gpsAtMs,
  simulationMeters,
  arrived,
  viewKey,
  onArrive,
  onOffRoute,
}: {
  mapRef: RefObject<MapLibreMap | null>;
  containerRef: RefObject<HTMLDivElement | null>;
  mapReady: boolean;
  route: RouteResponse | null;
  /** Whose position drives guidance: the real GPS or the simulated walker. */
  source: 'gps' | 'simulation';
  gpsPoint: GeoPoint | null;
  gpsAccuracyMeters: number;
  /** When that position was measured (ms since epoch). */
  gpsAtMs: number;
  /** Distance walked by the simulated walker along the route. */
  simulationMeters: number;
  /** The visitor was told they arrived (by this hook for the GPS, by the walk for the simulation). */
  arrived: boolean;
  /** Changes when the screen layout changes (old/new map): re-frames while following. */
  viewKey: string;
  onArrive(): void;
  onOffRoute(): void;
}) {
  const [mode, setModeState] = useState<CameraMode>('explore');
  const [progress, setProgress] = useState<RouteProgressInfo | null>(null);
  /** The GPS stopped reporting: the view is kept and the visitor is told we are waiting. */
  const [waitingForFix, setWaitingForFix] = useState(false);
  const modeRef = useRef<CameraMode>('explore');
  /** The whole-route view was chosen by us (a new route), not by the visitor. */
  const autoOverviewRef = useRef(false);
  const setMode = useCallback((next: CameraMode) => {
    modeRef.current = next;
    setModeState(next);
  }, []);
  const index = useMemo(
    () => (route ? buildRouteIndex(route.geometry.coordinates) : null),
    [route],
  );
  const progressRef = useRef<number | null>(null);
  const positionRef = useRef<GeoPoint | null>(null);
  const lastMoveRef = useRef(0);
  const trailingRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const arriveWatch = useRef<WatchState>(EMPTY_WATCH);
  const offWatch = useRef<WatchState>(EMPTY_WATCH);
  const callbacks = useRef({ onArrive, onOffRoute });
  callbacks.current = { onArrive, onOffRoute };
  const tickRef = useRef<() => void>(() => {});

  /** Space the interface leaves free on the map right now. */
  const usableInsets = useCallback((): Insets => {
    const container = containerRef.current;
    if (!container) return { top: 24, right: 24, bottom: 24, left: 24 };
    const canvas = container.getBoundingClientRect();
    const rects = OVERLAY_SELECTORS.flatMap((selector) =>
      [...document.querySelectorAll<HTMLElement>(selector)].map((element) => {
        const box = element.getBoundingClientRect();
        return {
          left: box.left - canvas.left,
          top: box.top - canvas.top,
          right: box.right - canvas.left,
          bottom: box.bottom - canvas.top,
        };
      }),
    );
    return insetsFromRects(
      { width: canvas.width, height: canvas.height },
      rects,
    );
  }, [containerRef]);

  // Programmatic moves tag themselves so they are never mistaken for the visitor's hand.
  const moveCamera = useCallback(
    (run: (map: MapLibreMap) => void) => {
      const map = mapRef.current;
      if (!map) return;
      lastMoveRef.current = Date.now();
      run(map);
    },
    [mapRef],
  );

  const frameFollow = useCallback(
    (force: boolean) => {
      const map = mapRef.current;
      const position = positionRef.current;
      const distance = progressRef.current;
      if (!map || !index || !position || distance === null) return;
      const insets = usableInsets();
      const bounds = followWindow(index, distance, position);
      const camera = map.cameraForBounds(bounds, {
        padding: insets,
        maxZoom: MAX_ZOOM,
        bearing: map.getBearing(),
      });
      if (!camera || camera.zoom === undefined || !camera.center) return;
      const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, camera.zoom));
      const center = camera.center as { lng: number; lat: number };
      const canvas = map.getContainer();
      const usableW = canvas.clientWidth - insets.left - insets.right;
      const usableH = canvas.clientHeight - insets.top - insets.bottom;
      // Move only when it matters: zoom changed enough, the visitor nears the edge of the
      // usable window, or the framing drifted a quarter of it.
      const spot = map.project([position.longitude, position.latitude]);
      const safeX = (usableW * (1 - FOLLOW_DEFAULTS.safeZone)) / 2;
      const safeY = (usableH * (1 - FOLLOW_DEFAULTS.safeZone)) / 2;
      const outside =
        spot.x < insets.left + safeX ||
        spot.x > canvas.clientWidth - insets.right - safeX ||
        spot.y < insets.top + safeY ||
        spot.y > canvas.clientHeight - insets.bottom - safeY;
      const now = map.project(center);
      const here = map.project(map.getCenter());
      const drift = Math.hypot(now.x - here.x, now.y - here.y);
      const needed =
        force ||
        Math.abs(zoom - map.getZoom()) >= FOLLOW_DEFAULTS.zoomThreshold ||
        outside ||
        drift >= 0.25 * Math.min(usableW, usableH);
      if (!needed) return;
      moveCamera((m) =>
        m.easeTo({
          center,
          zoom,
          bearing: m.getBearing(),
          duration: MOVE_DURATION_MS,
          essential: true,
        }),
      );
    },
    [index, mapRef, moveCamera, usableInsets],
  );

  const frameOverview = useCallback(() => {
    const map = mapRef.current;
    if (!map || !index) return;
    moveCamera((m) =>
      m.fitBounds(boundsOf(index.coordinates, FOLLOW_DEFAULTS.minCoverMeters), {
        padding: roomy(usableInsets()),
        maxZoom: OVERVIEW_MAX_ZOOM,
        bearing: m.getBearing(),
        duration: 500,
        essential: true,
      }),
    );
  }, [index, mapRef, moveCamera, usableInsets]);

  const frameArrival = useCallback(() => {
    const map = mapRef.current;
    if (!map || !index) return;
    const end = pointAt(index, index.totalMeters);
    const around = [[end.longitude, end.latitude] as [number, number]];
    const here = positionRef.current;
    if (here) around.push([here.longitude, here.latitude]);
    moveCamera((m) =>
      m.fitBounds(boundsOf(around), {
        padding: usableInsets(),
        maxZoom: 18.5,
        bearing: m.getBearing(),
        duration: 600,
        essential: true,
      }),
    );
  }, [index, mapRef, moveCamera, usableInsets]);

  // A new route (or none): reset, and start following when there is one.
  useEffect(() => {
    progressRef.current = null;
    positionRef.current = null;
    arriveWatch.current = EMPTY_WATCH;
    offWatch.current = EMPTY_WATCH;
    setProgress(null);
    setWaitingForFix(false);
    if (!route) {
      setMode('explore');
      return;
    }
    // A reroute keeps what the visitor chose. A first route opens on the whole way, from
    // here to the destination (like a maps app's route preview); the GPS visitor who
    // starts walking is then followed.
    if (modeRef.current === 'explore' || modeRef.current === 'arrived') {
      autoOverviewRef.current = true;
      setMode('overview');
    }
    lastMoveRef.current = 0;
  }, [route, setMode]);

  // The visitor's hand on the map: free camera. Events from our own moves carry no originalEvent.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const release = (event: { originalEvent?: unknown }) => {
      if (!event.originalEvent) return;
      if (modeRef.current === 'follow' || modeRef.current === 'overview') {
        autoOverviewRef.current = false;
        setMode('free');
      }
    };
    const types = [
      'dragstart',
      'zoomstart',
      'rotatestart',
      'pitchstart',
    ] as const;
    for (const type of types) map.on(type, release);
    return () => {
      for (const type of types) map.off(type, release);
    };
  }, [mapReady, mapRef, setMode]);

  // The visitor was told they arrived (simulated walk): settle on the destination.
  useEffect(() => {
    if (arrived && route && modeRef.current !== 'arrived') {
      setMode('arrived');
      frameArrival();
    }
  }, [arrived, frameArrival, route, setMode]);

  // One guidance tick per position update.
  useEffect(() => {
    if (!index || !route) return;
    const tick = () => {
      const now = Date.now();
      let position: GeoPoint | null;
      let measured: number | null;
      let lateral = 0;
      let accuracy: number;
      if (source === 'simulation') {
        measured = simulationMeters;
        position = pointAt(index, simulationMeters);
        accuracy = 5;
      } else {
        position = gpsPoint;
        accuracy = gpsAccuracyMeters;
        setWaitingForFix(
          !position || now - gpsAtMs > FOLLOW_DEFAULTS.maxFixAgeMs,
        );
        if (!position) return;
        const projected = projectOnRoute(index, position, progressRef.current);
        if (!projected) return;
        measured = projected.distanceAlong;
        lateral = projected.lateralMeters;
      }
      const distanceAlong = steadyProgress(progressRef.current, measured);
      progressRef.current = distanceAlong;
      positionRef.current = position;
      setProgress((previous) =>
        previous &&
        Math.abs(previous.distanceAlong - distanceAlong) < 1 &&
        Math.abs(previous.lateralMeters - lateral) < 1
          ? previous
          : {
              distanceAlong,
              remainingMeters: Math.max(0, index.totalMeters - distanceAlong),
              lateralMeters: lateral,
            },
      );

      if (source === 'gps' && modeRef.current !== 'arrived') {
        const end = pointAt(index, index.totalMeters);
        // A stale fix (the phone stopped reporting) decides nothing, neither way.
        const usable =
          isUsableFix(accuracy) && now - gpsAtMs <= FOLLOW_DEFAULTS.maxFixAgeMs;
        const toEnd = geoDistanceMeters(position, end);
        const arrive = holdFor(
          arriveWatch.current,
          toEnd <= FOLLOW_DEFAULTS.arriveMeters ||
            index.totalMeters - distanceAlong <= 5,
          usable,
          now,
          FOLLOW_DEFAULTS.arriveMs,
        );
        arriveWatch.current = arrive.state;
        if (arrive.fired) {
          setMode('arrived');
          frameArrival();
          callbacks.current.onArrive();
          return;
        }
        const off = holdFor(
          offWatch.current,
          lateral > FOLLOW_DEFAULTS.offRouteMeters,
          usable,
          now,
          FOLLOW_DEFAULTS.offRouteMs,
        );
        offWatch.current = off.state;
        if (off.fired) {
          offWatch.current = EMPTY_WATCH;
          callbacks.current.onOffRoute();
        }
      }

      if (
        source === 'gps' &&
        modeRef.current === 'overview' &&
        autoOverviewRef.current &&
        distanceAlong >= AUTO_FOLLOW_METERS
      ) {
        autoOverviewRef.current = false;
        setMode('follow');
        lastMoveRef.current = 0;
        frameFollow(true);
        return;
      }
      if (modeRef.current !== 'follow') return;
      const wait = MIN_MOVE_INTERVAL_MS - (now - lastMoveRef.current);
      if (wait <= 0) frameFollow(false);
      else if (trailingRef.current === null) {
        trailingRef.current = setTimeout(() => {
          trailingRef.current = null;
          if (modeRef.current === 'follow') frameFollow(false);
        }, wait);
      }
    };
    tickRef.current = tick;
    tick();
  }, [
    frameArrival,
    frameFollow,
    gpsAccuracyMeters,
    gpsAtMs,
    gpsPoint,
    index,
    route,
    setMode,
    simulationMeters,
    source,
  ]);

  // A stationary visitor still counts time (arrival and off-route need it): tick every second.
  useEffect(() => {
    if (!route) return;
    const timer = setInterval(() => tickRef.current(), 1000);
    return () => clearInterval(timer);
  }, [route]);

  // Resize or the other map picture: re-frame, but only if the visitor is being followed.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const reframe = () => {
      if (modeRef.current === 'follow') frameFollow(true);
      else if (modeRef.current === 'overview') frameOverview();
    };
    map.on('resize', reframe);
    if (route) reframe();
    return () => {
      map.off('resize', reframe);
    };
    // viewKey: the old/new map switch.
  }, [frameFollow, frameOverview, mapReady, mapRef, route, viewKey]);

  useEffect(
    () => () => {
      if (trailingRef.current) clearTimeout(trailingRef.current);
    },
    [],
  );

  // For tests and assistive tech: what the camera is doing, on the map element.
  useEffect(() => {
    containerRef.current?.setAttribute('data-camera-mode', mode);
  }, [containerRef, mode]);
  useEffect(() => {
    const map = mapRef.current;
    const element = containerRef.current;
    if (!map || !mapReady || !element) return;
    const record = () => {
      element.setAttribute('data-camera-zoom', map.getZoom().toFixed(2));
      element.setAttribute(
        'data-camera-moves',
        String(Number(element.getAttribute('data-camera-moves') ?? 0) + 1),
      );
    };
    map.on('moveend', record);
    return () => {
      map.off('moveend', record);
    };
  }, [containerRef, mapReady, mapRef]);

  // The part of the route already walked, for the faded line (updated every ~2 m).
  const doneKey = progress ? Math.round(progress.distanceAlong / 2) : -1;
  const walked = useMemo(
    () => (index && doneKey > 0 ? sliceRoute(index, 0, doneKey * 2) : null),
    [index, doneKey],
  );

  const followMe = useCallback(() => {
    if (!route || modeRef.current === 'arrived') return;
    autoOverviewRef.current = false;
    setMode('follow');
    lastMoveRef.current = 0;
    frameFollow(true);
  }, [frameFollow, route, setMode]);

  const showOverview = useCallback(() => {
    if (!route || modeRef.current === 'arrived') return;
    autoOverviewRef.current = false;
    setMode('overview');
    frameOverview();
  }, [frameOverview, route, setMode]);

  return { mode, progress, walked, waitingForFix, followMe, showOverview };
}
