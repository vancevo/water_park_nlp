'use client';

import type {
  AuthResponse,
  GeoPoint,
  PoiDetail,
  NarrationLocaleCatalog,
  PoiNarration,
  PoiSummary,
  RouteResponse,
} from '@damsen/shared-types';
import type {
  GeoJSONSource,
  Map as MapLibreMap,
  MapMouseEvent,
  Marker,
  StyleSpecification,
} from 'maplibre-gl';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { visitorApi } from '@/lib/api';
import {
  ILLUSTRATED_LAYER,
  addIllustratedMap,
  loadIllustratedGeoref,
} from '@/lib/map-pictures';
import { amenityIconUrl, amenityKind } from '@/lib/amenities';
import {
  loadSubPlaces,
  subPlaceName,
  subPlacesFor,
  type SubPlace,
  type SubPlaces,
} from '@/lib/sub-places';
import { categoryLabel, formatDistance, formatDuration } from '@/lib/format';
import {
  readUiLocalePreference,
  saveUiLocalePreference,
  contentLocale,
  uiText,
  type UiLocale,
  type UiText,
} from '@/lib/ui-text';
import {
  geoDistanceMeters,
  routeLengthMeters,
  routeProgressAt,
  simulationDistanceAtTime,
  simulationDurationMs,
  type RouteProgress,
} from '@/lib/route-simulation';
import { localeLabel, speechTagFor } from '@/lib/narration-locales';
import {
  clearVisitorSession,
  readVisitorSession,
  saveVisitorSession,
} from '@/lib/session';
import { formatPoiNumber, sortByPoiNumber } from '@/lib/poi-number';
import {
  AUTO_GUIDE_DEFAULTS,
  EMPTY_GUIDE_STATE,
  evaluateAutoGuide,
  isAutoNarrationEligible,
  AUTO_TRIGGER_ALSO_NEAR,
  guideDistanceMeters,
  markGuideFired,
  type GuideFix,
  type GuideState,
} from '@/lib/proximity-guide';
import { narrationKey } from '@/lib/listen-history';
import { pickNextStop, type NextStopKind } from '@/lib/next-stop';
import { loadWalkNodes, snapToWalkNode } from '@/lib/snap-to-walkway';
import { loadZones, type Zone } from '@/lib/zones';
import { loadPlayable } from '@/lib/narration-load';
import type { PlaySource, RequestResult } from '@/lib/narration-player';
import { AudioBar } from './audio-bar';
import { NarrationSection, useVisitorNarration } from './narration-section';
import { useNarrationPlayer } from './use-narration-player';
import { usePoiMarkers } from './use-poi-markers';
import { useRouteCamera, type CameraMode } from './use-route-camera';
import { useZoneGuide } from './use-zone-guide';
import { NextStopBox, NowPlayingCard, ZoneCard } from './zone-panels';

/**
 * Wraps a pin so MapLibre can place it: MapLibre overwrites the marker element's own transform,
 * so the pin (turned -45deg about its bottom-left corner, which becomes the tip) lives inside.
 * With anchor 'bottom-left' the tip sits exactly on the place's coordinates.
 */
function pinAnchor(pin: HTMLElement, small = false): HTMLElement {
  const anchor = document.createElement('div');
  anchor.className = `pin-anchor${small ? ' sub' : ''}`;
  anchor.appendChild(pin);
  return anchor;
}

/** Padding for camera moves: the place card lives in the side panel, not over the map. */
function cameraPadding() {
  return { top: 90, left: 60, bottom: 60, right: 60 };
}

const FALLBACK_CENTER: [number, number] = [106.63864, 10.76443];
type MapKind = 'old' | 'new';
const MAP_TILE_URL = process.env.NEXT_PUBLIC_MAP_TILE_URL;
const MAP_TILE_ATTRIBUTION =
  process.env.NEXT_PUBLIC_MAP_TILE_ATTRIBUTION ??
  'Powered by <a href="https://www.geoapify.com/" target="_blank" rel="noopener noreferrer">Geoapify</a> | <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">© OpenStreetMap contributors</a>';
const DEFAULT_MAP_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    researchPark: {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: { kind: 'park' },
            geometry: {
              type: 'Polygon',
              coordinates: [
                [
                  [106.6347, 10.7667],
                  [106.636, 10.7667],
                  [106.636, 10.76765],
                  [106.6347, 10.76765],
                  [106.6347, 10.7667],
                ],
              ],
            },
          },
          {
            type: 'Feature',
            properties: { kind: 'water' },
            geometry: {
              type: 'Polygon',
              coordinates: [
                [
                  [106.63505, 10.76708],
                  [106.63546, 10.7669],
                  [106.63582, 10.76713],
                  [106.63555, 10.76738],
                  [106.63505, 10.76708],
                ],
              ],
            },
          },
        ],
      },
    },
    researchWalkways: {
      type: 'geojson',
      data: {
        type: 'Feature',
        properties: {},
        geometry: {
          type: 'MultiLineString',
          coordinates: [
            [
              [106.63482, 10.767],
              [106.635, 10.767],
              [106.63535, 10.767],
              [106.6357, 10.767],
              [106.6359, 10.7671],
            ],
            [
              [106.6349, 10.7673],
              [106.63535, 10.7673],
              [106.6357, 10.7673],
              [106.6359, 10.76745],
            ],
            [
              [106.635, 10.76682],
              [106.635, 10.767],
              [106.635, 10.7673],
              [106.635, 10.76752],
            ],
            [
              [106.6357, 10.76682],
              [106.6357, 10.767],
              [106.6357, 10.7673],
              [106.6357, 10.76752],
            ],
          ],
        },
      },
    },
  },
  layers: [
    {
      id: 'research-background',
      type: 'background',
      paint: { 'background-color': '#e6eee3' },
    },
    {
      id: 'research-park',
      type: 'fill',
      source: 'researchPark',
      filter: ['==', ['get', 'kind'], 'park'],
      paint: {
        'fill-color': '#c6ddbd',
        'fill-outline-color': '#86a67d',
      },
    },
    {
      id: 'research-water',
      type: 'fill',
      source: 'researchPark',
      filter: ['==', ['get', 'kind'], 'water'],
      paint: {
        'fill-color': '#9ed7df',
        'fill-outline-color': '#70b3bd',
      },
    },
    {
      id: 'research-walkways-outline',
      type: 'line',
      source: 'researchWalkways',
      paint: { 'line-color': '#9ba88f', 'line-width': 13 },
      layout: { 'line-cap': 'round', 'line-join': 'round' },
    },
    {
      id: 'research-walkways',
      type: 'line',
      source: 'researchWalkways',
      paint: { 'line-color': '#fffaf0', 'line-width': 8 },
      layout: { 'line-cap': 'round', 'line-join': 'round' },
    },
  ],
};
const GEOAPIFY_MAP_STYLE: StyleSpecification | undefined = MAP_TILE_URL
  ? {
      version: 8,
      sources: {
        geoapify: {
          type: 'raster',
          tiles: [MAP_TILE_URL],
          tileSize: 256,
          maxzoom: 20,
          attribution: MAP_TILE_ATTRIBUTION,
        },
      },
      layers: [
        {
          id: 'geoapify-basemap',
          type: 'raster',
          source: 'geoapify',
        },
      ],
    }
  : undefined;
const MAP_STYLE =
  process.env.NEXT_PUBLIC_MAP_STYLE_URL ??
  GEOAPIFY_MAP_STYLE ??
  DEFAULT_MAP_STYLE;

type AuthMode = 'login' | 'register';

const SIMULATED_FIX_ACCURACY_METERS = 5;
const PANEL_STORAGE_KEY = 'damsen.visitor.panel.v1';
/** Away from the app at least this long: coming back asks where to go next. */
const AWAY_WELCOME_MS = 60_000;
/** Where the feet are in the 58x122 walker sprite (x 66 %, y 79 %), as a marker offset. */
const WALKER_FEET_OFFSET: [number, number] = [-38, -96];
/** Clusters never zoom closer than this; past it they open a list instead. */
const MAX_CLUSTER_ZOOM = 19.5;
const GPS_MIN_MOVE_METERS = 15;
interface GuideReading {
  inaccurate: boolean;
  stale: boolean;
  accuracyMeters: number;
  /** The closest place that can narrate by itself, if any is within 300 m. */
  nearest: { name: string; distance: number; near: boolean } | null;
}

export function VisitorExperience() {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const zoneCardsRef = useRef<HTMLDivElement>(null);
  const detailRef = useRef<HTMLElement>(null);
  const mapPanelRef = useRef<HTMLElement>(null);
  const walkNodesRef = useRef<GeoPoint[]>([]);
  const mapRef = useRef<MapLibreMap | null>(null);
  const userMarkerRef = useRef<Marker | null>(null);
  const simulationMarkerRef = useRef<Marker | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [mapKind, setMapKind] = useState<MapKind>('new');
  // Bearing that shows the official map upright; null until the picture loaded.
  const [illustratedBearing, setIllustratedBearing] = useState<number | null>(
    null,
  );
  const illustratedReady = illustratedBearing !== null;
  const [locale, setLocaleState] = useState<UiLocale>('vi');
  const t = uiText(locale);
  const changeLocale = useCallback((next: UiLocale) => {
    setLocaleState(next);
    saveUiLocalePreference(next);
  }, []);
  const [pois, setPois] = useState<PoiSummary[]>([]);
  // Auto narration near fixed places (lib/proximity-guide.ts)
  const [autoGuide, setAutoGuide] = useState(false);
  const [autoTargets, setAutoTargets] = useState<PoiSummary[]>([]);
  // Every place (services included): zones, "where next" and the zone introductions use them.
  const [allPois, setAllPois] = useState<PoiSummary[]>([]);
  const [zones, setZones] = useState<Zone[]>([]);
  // Bumps when auto narration is switched on or the visitor comes back to the app.
  const [welcomeTicket, setWelcomeTicket] = useState(0);
  const [gpsFix, setGpsFix] = useState<GuideFix | null>(null);
  const [guideDenied, setGuideDenied] = useState(false);
  const [guideReading, setGuideReading] = useState<GuideReading | null>(null);
  const guideStateRef = useRef<GuideState>(EMPTY_GUIDE_STATE);
  const [selected, setSelected] = useState<PoiSummary | null>(null);
  // Attractions inside big places (children's area, ...); `activeChild` is the one tapped.
  const [subPlaces, setSubPlaces] = useState<SubPlaces>({});
  const [activeChild, setActiveChild] = useState<number | null>(null);
  const subMarkersRef = useRef<Marker[]>([]);
  const subPlacesRef = useRef<SubPlaces>({});
  subPlacesRef.current = subPlaces;
  const [detail, setDetail] = useState<PoiDetail | null>(null);
  const [route, setRoute] = useState<RouteResponse | null>(null);
  const [position, setPosition] = useState<GeoPoint | null>(null);
  const [simulationPosition, setSimulationPosition] = useState<GeoPoint | null>(
    null,
  );
  const [isPickingSimulation, setIsPickingSimulation] = useState(false);
  const [isWalking, setIsWalking] = useState(false);
  const [simulationDistanceMeters, setSimulationDistanceMeters] = useState(0);
  const [detailCardOpen, setDetailCardOpen] = useState(false);
  // The left panel (search, places, place card) slides away to leave the whole map.
  const [panelOpen, setPanelOpen] = useState(true);
  const [arrivalOpen, setArrivalOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState('');
  const [session, setSession] = useState<AuthResponse | null>(null);
  const [authMode, setAuthMode] = useState<AuthMode | null>(null);
  const {
    catalog: narrationCatalog,
    catalogStatus: narrationCatalogStatus,
    narrationLocale,
    setNarrationLocale,
    narration,
    status: narrationStatus,
    retry: retryNarration,
    retryCatalog: retryNarrationCatalog,
  } = useVisitorNarration(selected?.id ?? null, locale);
  const effectivePosition = simulationPosition ?? position;
  const simulationProgress: RouteProgress | null = route
    ? routeProgressAt(route.geometry.coordinates, simulationDistanceMeters)
    : null;

  const cancelSimulationAnimation = useCallback(() => {
    if (animationFrameRef.current !== null) {
      window.cancelAnimationFrame(animationFrameRef.current);
      animationFrameRef.current = null;
    }
    setIsWalking(false);
  }, []);

  const { player, state: playerState, speechSupported } = useNarrationPlayer();
  const narrationLocaleRef = useRef(narrationLocale);
  narrationLocaleRef.current = narrationLocale;
  const catalogRef = useRef(narrationCatalog);
  catalogRef.current = narrationCatalog;
  const selectedRef = useRef<PoiSummary | null>(null);

  /**
   * The only way audio starts: clicks, the GPS and the Listen buttons all ask the one
   * shared player (lib/narration-player.ts), which applies the rules and never plays
   * two narrations at once.
   */
  const requestPlay = useCallback(
    async (poi: PoiSummary, source: PlaySource): Promise<RequestResult> => {
      const locale = narrationLocaleRef.current;
      if (!player || !locale) return 'ignored';
      const result = await player.request({
        source,
        poiId: poi.id,
        poiName: poi.name,
        locale,
        load: () =>
          loadPlayable({
            poiId: poi.id,
            poiName: poi.name,
            locale,
            catalog: catalogRef.current,
            source,
            fallbackText: poi.shortDescription,
          }),
      });
      if (result === 'blocked') setMessage(t.autoplayBlocked);
      else if (result === 'error') setMessage(t.playbackFailed);
      else if (result === 'missing' && source === 'manual') {
        setMessage(t.noNarrationToPlay);
      }
      return result;
    },
    [player, t],
  );
  const requestPlayRef = useRef(requestPlay);
  requestPlayRef.current = requestPlay;
  const stopPlayback = useCallback(() => player?.stop(), [player]);

  const openPoi = useCallback(
    (poi: PoiSummary) => {
      cancelSimulationAnimation();
      setSelected(poi);
      setActiveChild(null);
      setDetailCardOpen(true);
      // Opening a place is a click on it: the player plays it only if auto is on and
      // it was not heard yet; otherwise just the card opens.
      void requestPlayRef.current(poi, 'poi-click');
      // The card opens in the left panel (below the map on phones): open the panel and show it.
      setPanelOpen(true);
      window.requestAnimationFrame(() => {
        const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)')
          .matches;
        if (window.matchMedia('(max-width: 820px)').matches) {
          detailRef.current?.scrollIntoView({
            behavior: smooth ? 'smooth' : 'auto',
            block: 'start',
          });
        } else {
          panelRef.current?.scrollTo({
            top: 0,
            behavior: smooth ? 'smooth' : 'auto',
          });
        }
      });
    },
    [cancelSimulationAnimation],
  );

  useEffect(() => setSession(readVisitorSession()), []);

  // Remembered open/closed state, read after mount so the server markup stays open.
  useEffect(() => {
    const narrow = window.matchMedia('(max-width: 820px)');
    // On phones the panel is part of the page flow and cannot be collapsed.
    const onChange = () => {
      if (narrow.matches) setPanelOpen(true);
    };
    narrow.addEventListener('change', onChange);
    try {
      if (
        !narrow.matches &&
        window.localStorage.getItem(PANEL_STORAGE_KEY) === 'closed'
      ) {
        setPanelOpen(false);
      }
    } catch {
      // Blocked storage: the panel simply opens every time.
    }
    return () => narrow.removeEventListener('change', onChange);
  }, []);
  const togglePanel = useCallback(() => {
    setPanelOpen((open) => {
      try {
        window.localStorage.setItem(
          PANEL_STORAGE_KEY,
          open ? 'closed' : 'open',
        );
      } catch {
        // ignore
      }
      return !open;
    });
  }, []);

  // The map box changes size while the panel slides: keep the canvas in step with it.
  useEffect(() => {
    const container = mapContainerRef.current;
    if (!container || !mapReady) return;
    let frame: number | null = null;
    const observer = new ResizeObserver(() => {
      if (frame !== null) return;
      frame = window.requestAnimationFrame(() => {
        frame = null;
        mapRef.current?.resize();
      });
    });
    observer.observe(container);
    return () => {
      observer.disconnect();
      if (frame !== null) window.cancelAnimationFrame(frame);
    };
  }, [mapReady]);

  useEffect(
    () => () => cancelSimulationAnimation(),
    [cancelSimulationAnimation],
  );

  selectedRef.current = selected;

  // Another narration language: forget requests for the old one and stop its audio when it
  // belongs to the place being viewed. Choosing a place never stops anything by itself.
  useEffect(() => {
    if (!player) return;
    player.cancelPending();
    const active = player.getSnapshot().active;
    if (
      active &&
      narrationLocale &&
      active.locale !== narrationLocale &&
      active.poiId === selectedRef.current?.id
    ) {
      player.stop();
    }
  }, [narrationLocale, player]);

  const loadPois = useCallback(async () => {
    setLoading(true);
    setMessage('');
    try {
      const locationQuery = effectivePosition
        ? {
            lat: effectivePosition.latitude,
            lng: effectivePosition.longitude,
          }
        : {};
      const response = query.trim()
        ? await visitorApi.search({
            q: query.trim(),
            locale: contentLocale(locale),
            limit: 30,
            ...locationQuery,
          })
        : await visitorApi.listPois({
            locale: contentLocale(locale),
            ...locationQuery,
          });
      // Numbers are fixed per place: distance only decorates the list, it
      // never reorders or renumbers it. Search keeps its relevance order.
      setPois(query.trim() ? response.items : sortByPoiNumber(response.items));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t.loadPlacesFailed);
    } finally {
      setLoading(false);
    }
  }, [effectivePosition, locale, query]);

  useEffect(() => {
    const timeout = window.setTimeout(() => void loadPois(), 260);
    return () => window.clearTimeout(timeout);
  }, [loadPois]);

  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;
    let cancelled = false;
    void import('maplibre-gl').then((maplibregl) => {
      if (cancelled || !mapContainerRef.current) return;
      maplibregl.setWorkerUrl('/maplibre/maplibre-gl-worker.mjs');
      const map = new maplibregl.Map({
        container: mapContainerRef.current,
        style: MAP_STYLE,
        center: FALLBACK_CENTER,
        zoom: 15.6,
        attributionControl: false,
      });
      map.addControl(new maplibregl.NavigationControl(), 'bottom-right');
      if (GEOAPIFY_MAP_STYLE) {
        map.addControl(
          new maplibregl.AttributionControl({ compact: true }),
          'bottom-left',
        );
      }
      map.once('load', () => {
        map.addSource('damsen-osm-walkways', {
          type: 'geojson',
          data: '/data/damsen-walkways.geojson',
          attribution: '© OpenStreetMap contributors',
        });
        void addIllustratedMap(map).then(setIllustratedBearing);
        map.addLayer({
          id: 'damsen-osm-walkways-outline',
          type: 'line',
          source: 'damsen-osm-walkways',
          paint: {
            'line-color': '#1f513f',
            'line-width': 6,
            'line-opacity': 0.72,
          },
          layout: { 'line-cap': 'round', 'line-join': 'round' },
        });
        map.addLayer({
          id: 'damsen-osm-walkways',
          type: 'line',
          source: 'damsen-osm-walkways',
          paint: {
            'line-color': '#f7f0db',
            'line-width': 3,
            'line-opacity': 0.96,
          },
          layout: { 'line-cap': 'round', 'line-join': 'round' },
        });
        setMapReady(true);
      });
      mapRef.current = map;
    });
    return () => {
      cancelled = true;
      userMarkerRef.current?.remove();
      simulationMarkerRef.current?.remove();
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  // Escape closes the top-most layer: auth dialog, arrival dialog, POI card.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (authMode) setAuthMode(null);
      else if (arrivalOpen) {
        stopPlayback();
        setArrivalOpen(false);
      } else if (detailCardOpen) setDetailCardOpen(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [arrivalOpen, authMode, detailCardOpen, stopPlayback]);

  // Old map = OSM base + walkways; new = the official map under them, turned upright.
  useEffect(() => {
    const map = mapRef.current;
    if (
      !map ||
      !mapReady ||
      !illustratedReady ||
      !map.getLayer(ILLUSTRATED_LAYER)
    )
      return;
    map.setLayoutProperty(
      ILLUSTRATED_LAYER,
      'visibility',
      mapKind === 'new' ? 'visible' : 'none',
    );
    map.easeTo({
      bearing: mapKind === 'new' ? (illustratedBearing ?? 0) : 0,
      duration: 500,
    });
  }, [illustratedBearing, illustratedReady, mapKind, mapReady]);

  // Remembered interface language (read after mount so SSR markup stays 'vi').
  useEffect(() => {
    const saved = readUiLocalePreference();
    if (saved) setLocaleState(saved);
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.title = t.documentTitle;
    const marker = simulationMarkerRef.current?.getElement();
    if (marker) {
      marker.title = t.simulatedWalker;
      marker.setAttribute('aria-label', t.simulatedWalker);
    }
  }, [locale, t]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !isPickingSimulation) return;
    const canvas = map.getCanvas();
    canvas.classList.add('placing-human');
    const placeHuman = (event: MapMouseEvent) => {
      cancelSimulationAnimation();
      const clicked = {
        latitude: event.lngLat.lat,
        longitude: event.lngLat.lng,
      };
      // The walker stands on the path line (its nearest node), where the route starts.
      setSimulationPosition(
        snapToWalkNode(clicked, walkNodesRef.current)?.point ?? clicked,
      );
      setSimulationDistanceMeters(0);
      setRoute(null);
      setArrivalOpen(false);
      setIsPickingSimulation(false);
      setMessage(t.simulationPlaced);
    };
    map.once('click', placeHuman);
    return () => {
      canvas.classList.remove('placing-human');
      map.off('click', placeHuman);
    };
  }, [cancelSimulationAnimation, isPickingSimulation, mapReady]);

  // Pins sized by zoom, clustered where their touch areas would overlap (lib/marker-layout.ts).
  const [referenceZoom, setReferenceZoom] = useState<number | null>(null);
  const [clusterMenu, setClusterMenu] = useState<{
    ids: string[];
    x: number;
    y: number;
  } | null>(null);
  const priorityIds = useMemo(
    () =>
      [selected?.id, playerState.active?.poiId].filter((id): id is string =>
        Boolean(id),
      ),
    [selected?.id, playerState.active?.poiId],
  );
  const handleCluster = useCallback(
    (ids: string[], screen: { x: number; y: number }) => {
      const map = mapRef.current;
      const members = pois.filter((poi) => ids.includes(poi.id));
      if (!map || members.length === 0) return;
      const lngs = members.map((poi) => poi.location.longitude);
      const lats = members.map((poi) => poi.location.latitude);
      const sw = { latitude: Math.min(...lats), longitude: Math.min(...lngs) };
      const ne = { latitude: Math.max(...lats), longitude: Math.max(...lngs) };
      // Zooming cannot pull these apart (already close in, or the same spot): list them.
      if (
        map.getZoom() >= MAX_CLUSTER_ZOOM - 0.3 ||
        geoDistanceMeters(sw, ne) < 6
      ) {
        setClusterMenu({ ids, ...screen });
        return;
      }
      setClusterMenu(null);
      map.fitBounds(
        [
          [sw.longitude, sw.latitude],
          [ne.longitude, ne.latitude],
        ],
        {
          padding: cameraPadding(),
          maxZoom: MAX_CLUSTER_ZOOM,
          bearing: map.getBearing(),
        },
      );
    },
    [pois],
  );
  usePoiMarkers({
    mapRef,
    containerRef: mapContainerRef,
    mapReady,
    pois,
    selectedId: selected?.id ?? null,
    priorityIds,
    referenceZoom,
    onOpen: (poi) => {
      setClusterMenu(null);
      openPoi(poi);
    },
    onCluster: handleCluster,
    clusterLabel: t.clusterLabel,
  });

  // --- guidance: the camera follows the visitor along the route (use-route-camera.ts) ---
  const gpsFixRef = useRef(gpsFix);
  gpsFixRef.current = gpsFix;
  const lastRerouteRef = useRef(0);
  // Left the route (real GPS only): ask for a new one from here, at most every 15 s.
  const reroute = useCallback(async () => {
    const destination = selectedRef.current;
    const fix = gpsFixRef.current;
    if (!destination || !fix || Date.now() - lastRerouteRef.current < 15_000) {
      return;
    }
    lastRerouteRef.current = Date.now();
    setMessage(t.rerouting);
    try {
      const result = await visitorApi.createRoute({
        from: { lat: fix.point.latitude, lng: fix.point.longitude },
        poiId: destination.id,
      });
      setRoute(result);
      setMessage(t.routeUpdated);
    } catch (error) {
      // Keep the old route and the position: nothing is drawn across the lake.
      setMessage(error instanceof Error ? error.message : t.routeFailed);
    }
  }, [t]);
  const handleArrive = useCallback(() => {
    setArrivalOpen(true);
    const destination = selectedRef.current;
    if (destination) void requestPlayRef.current(destination, 'auto-gps');
  }, []);
  const camera = useRouteCamera({
    mapRef,
    containerRef: mapContainerRef,
    mapReady,
    route,
    source: simulationPosition ? 'simulation' : 'gps',
    gpsPoint: gpsFix?.point ?? position,
    gpsAccuracyMeters: gpsFix?.accuracyMeters ?? 20,
    gpsAtMs: gpsFix?.atMs ?? Date.now(),
    simulationMeters: simulationDistanceMeters,
    arrived: arrivalOpen,
    viewKey: mapKind,
    onArrive: handleArrive,
    onOffRoute: () => void reroute(),
  });

  // Whole-park zoom for this screen: the size the pins are 20 px at (see pinSizeForZoom).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady || !illustratedReady) return;
    let cancelled = false;
    const measure = async () => {
      const georef = await loadIllustratedGeoref();
      const lngs = georef.corners.map((corner) => corner[0]);
      const lats = georef.corners.map((corner) => corner[1]);
      const camera = map.cameraForBounds(
        [
          [Math.min(...lngs), Math.min(...lats)],
          [Math.max(...lngs), Math.max(...lats)],
        ],
        {
          padding: 24,
          bearing: mapKind === 'new' ? (georef.bearingDegrees ?? 0) : 0,
        },
      );
      if (!cancelled && camera?.zoom !== undefined)
        setReferenceZoom(camera.zoom);
    };
    void measure();
    map.on('resize', measure);
    return () => {
      cancelled = true;
      map.off('resize', measure);
    };
  }, [illustratedReady, mapKind, mapReady]);

  // Escape / a map click closes the list of clustered places.
  useEffect(() => {
    if (!clusterMenu) return;
    const map = mapRef.current;
    const close = () => setClusterMenu(null);
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    map?.on('click', close);
    map?.on('movestart', close);
    return () => {
      window.removeEventListener('keydown', onKey);
      map?.off('click', close);
      map?.off('movestart', close);
    };
  }, [clusterMenu]);

  useEffect(() => {
    void loadSubPlaces().then(setSubPlaces);
  }, []);

  const selectedChildren = useMemo(
    () => (selected ? subPlacesFor(subPlaces, selected.slug) : []),
    [selected, subPlaces],
  );

  // Small pins of the attractions inside the selected big place (11.1, 11.2, ...).
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    let cancelled = false;
    void import('maplibre-gl').then((maplibregl) => {
      if (cancelled) return;
      subMarkersRef.current.forEach((marker) => marker.remove());
      subMarkersRef.current = [];
      selectedChildren.forEach((child, index) => {
        if (!child.pin || child.latitude === undefined) return;
        const element = document.createElement('button');
        element.className = `map-pin sub pin-${child.color ?? 'white'}${activeChild === index ? ' selected' : ''}`;
        element.type = 'button';
        element.ariaLabel = subPlaceName(child, locale);
        element.title = subPlaceName(child, locale);
        element.innerHTML = `<span>${child.pin}</span>`;
        element.addEventListener('click', () => setActiveChild(index));
        subMarkersRef.current.push(
          new maplibregl.Marker({
            element: pinAnchor(element, true),
            anchor: 'bottom-left',
          })
            .setLngLat([child.longitude!, child.latitude])
            .addTo(map),
        );
      });
    });
    return () => {
      cancelled = true;
      subMarkersRef.current.forEach((marker) => marker.remove());
      subMarkersRef.current = [];
    };
  }, [activeChild, locale, mapReady, selectedChildren]);

  // Tapping an attraction with a pin brings it to the centre of the map.
  useEffect(() => {
    const map = mapRef.current;
    const child = activeChild === null ? null : selectedChildren[activeChild];
    if (!map || !mapReady || !child || child.latitude === undefined) return;
    map.easeTo({
      center: [child.longitude!, child.latitude],
      zoom: Math.max(map.getZoom(), 18),
      padding: cameraPadding(),
      duration: 400,
    });
  }, [activeChild, mapReady, selectedChildren]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    if (!simulationPosition) {
      simulationMarkerRef.current?.remove();
      simulationMarkerRef.current = null;
      return;
    }
    let cancelled = false;
    void import('maplibre-gl').then((maplibregl) => {
      if (cancelled) return;
      if (simulationMarkerRef.current) {
        simulationMarkerRef.current.setLngLat([
          simulationPosition.longitude,
          simulationPosition.latitude,
        ]);
        return;
      }
      const element = document.createElement('div');
      element.className = 'simulated-human';
      element.title = t.simulatedWalker;
      element.setAttribute('aria-label', t.simulatedWalker);
      const avatar = document.createElement('img');
      avatar.className = 'chibi-sprite-strip';
      avatar.src = '/chibi-walker-spritesheet.png';
      avatar.alt = '';
      avatar.draggable = false;
      const spriteWindow = document.createElement('span');
      spriteWindow.className = 'chibi-sprite-window';
      spriteWindow.append(avatar);
      const shadow = document.createElement('span');
      shadow.className = 'chibi-shadow';
      // The sprite walks to the right; this wrapper mirrors it when the walker goes left.
      const flip = document.createElement('span');
      flip.className = 'chibi-flip';
      flip.append(spriteWindow, shadow);
      element.append(flip);
      // The point of the line is under the character's feet, not the frame's bottom centre.
      simulationMarkerRef.current = new maplibregl.Marker({
        element,
        anchor: 'top-left',
        offset: WALKER_FEET_OFFSET,
      })
        .setLngLat([simulationPosition.longitude, simulationPosition.latitude])
        .addTo(map);
    });
    return () => {
      cancelled = true;
    };
  }, [mapReady, simulationPosition]);

  useEffect(() => {
    simulationMarkerRef.current
      ?.getElement()
      .classList.toggle('is-walking', isWalking);
  }, [isWalking]);

  useEffect(() => {
    if (!selected) {
      setDetail(null);
      setRoute(null);
      setSimulationDistanceMeters(0);
      setArrivalOpen(false);
      return;
    }
    setDetail(null);
    setRoute(null);
    setSimulationDistanceMeters(0);
    setArrivalOpen(false);
    cancelSimulationAnimation();
    const pinned = subPlacesFor(subPlacesRef.current, selected.slug).filter(
      (child) => child.latitude !== undefined,
    );
    if (pinned.length > 0) {
      // A big place: show all its sub-pins, clear of the detail card on the right.
      const lngs = pinned.map((child) => child.longitude!);
      const lats = pinned.map((child) => child.latitude!);
      mapRef.current?.fitBounds(
        [
          [Math.min(...lngs), Math.min(...lats)],
          [Math.max(...lngs), Math.max(...lats)],
        ],
        {
          padding: cameraPadding(),
          maxZoom: 18.5,
          bearing: mapRef.current?.getBearing(),
        },
      );
    } else {
      mapRef.current?.flyTo({
        center: [selected.location.longitude, selected.location.latitude],
        zoom: 17.2,
      });
    }
    void visitorApi
      .getPoi(selected.id, contentLocale(locale))
      .then(setDetail)
      .catch(() => {});
  }, [cancelSimulationAnimation, locale, selected]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const layerId = 'active-route-line';
    const sourceId = 'active-route';
    if (!route) {
      if (map.getLayer(layerId)) map.removeLayer(layerId);
      if (map.getSource(sourceId)) map.removeSource(sourceId);
      return;
    }
    const existing = map.getSource(sourceId) as GeoJSONSource | undefined;
    if (existing) {
      existing.setData(route.geometry);
    } else {
      map.addSource(sourceId, { type: 'geojson', data: route.geometry });
      map.addLayer({
        id: layerId,
        type: 'line',
        source: sourceId,
        paint: {
          'line-color': '#f2a51a',
          'line-width': 7,
          'line-opacity': 0.9,
        },
        layout: { 'line-cap': 'round', 'line-join': 'round' },
      });
    }
  }, [mapReady, route]);

  // The walked part of the route, faded, on top of the orange line.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const layerId = 'active-route-done-line';
    const sourceId = 'active-route-done';
    const data = camera.walked
      ? {
          type: 'LineString' as const,
          coordinates: camera.walked,
        }
      : null;
    if (!data || !route) {
      if (map.getLayer(layerId)) map.removeLayer(layerId);
      if (map.getSource(sourceId)) map.removeSource(sourceId);
      return;
    }
    const existing = map.getSource(sourceId) as GeoJSONSource | undefined;
    if (existing) {
      existing.setData(data);
      return;
    }
    map.addSource(sourceId, { type: 'geojson', data });
    map.addLayer({
      id: layerId,
      type: 'line',
      source: sourceId,
      paint: {
        'line-color': '#9aa39d',
        'line-width': 7,
        'line-opacity': 0.85,
      },
      layout: { 'line-cap': 'round', 'line-join': 'round' },
    });
  }, [camera.walked, mapReady, route]);

  function stopGuidance() {
    cancelSimulationAnimation();
    setRoute(null);
    setArrivalOpen(false);
    setSimulationDistanceMeters(0);
  }

  async function locate(): Promise<GeoPoint> {
    if (!navigator.geolocation) throw new Error(t.gpsUnsupported);
    const coordinates = await new Promise<GeolocationCoordinates>(
      (resolve, reject) =>
        navigator.geolocation.getCurrentPosition(
          (result) => resolve(result.coords),
          reject,
          { enableHighAccuracy: true, timeout: 12000, maximumAge: 5000 },
        ),
    );
    const next = {
      latitude: coordinates.latitude,
      longitude: coordinates.longitude,
    };
    setPosition(next);
    const map = mapRef.current;
    if (map) {
      const maplibregl = await import('maplibre-gl');
      userMarkerRef.current?.remove();
      const element = document.createElement('div');
      element.className = 'user-location';
      userMarkerRef.current = new maplibregl.Marker({ element })
        .setLngLat([next.longitude, next.latitude])
        .addTo(map);
      map.flyTo({ center: [next.longitude, next.latitude], zoom: 17 });
    }
    return next;
  }

  async function navigateToSelected() {
    if (selected) await navigateTo(selected);
  }

  async function navigateTo(destination: PoiSummary) {
    cancelSimulationAnimation();
    setMessage('');
    try {
      const origin = simulationPosition ?? position ?? (await locate());
      const result = await visitorApi.createRoute({
        from: { lat: origin.latitude, lng: origin.longitude },
        poiId: destination.id,
      });
      setRoute(result);
      setSimulationDistanceMeters(0);
      setArrivalOpen(false);
      setDetailCardOpen(false);
      if (simulationPosition) {
        startAutomaticWalk(result);
      } else {
        setMessage(t.routeCreated);
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : t.routeFailed);
    }
  }

  // Places that may narrate by themselves, from the full list (not the search): every place
  // with a story, not the service points or the test spot.
  useEffect(() => {
    let cancelled = false;
    void visitorApi
      .listPois({ locale: contentLocale(locale) })
      .then((response) => {
        if (cancelled) return;
        setAllPois(response.items);
        setAutoTargets(
          sortByPoiNumber(
            response.items.filter((poi) => isAutoNarrationEligible(poi.slug)),
          ),
        );
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [locale]);

  useEffect(() => {
    void loadZones().then(setZones);
    void loadWalkNodes().then((nodes) => {
      walkNodesRef.current = nodes;
    });
  }, []);

  // Live GPS while the visitor opted in to auto narration, or is being guided along a route
  // with their real position (the simulated walker has its own source).
  const wantGps = autoGuide || (route !== null && simulationPosition === null);
  useEffect(() => {
    if (!wantGps) return;
    if (!navigator.geolocation) {
      setGuideDenied(true);
      return;
    }
    const watchId = navigator.geolocation.watchPosition(
      (result) => {
        const point = {
          latitude: result.coords.latitude,
          longitude: result.coords.longitude,
        };
        setGuideDenied(false);
        setGpsFix({
          point,
          accuracyMeters: result.coords.accuracy,
          atMs: result.timestamp,
        });
        setPosition((current) =>
          current && geoDistanceMeters(current, point) < GPS_MIN_MOVE_METERS
            ? current
            : point,
        );
      },
      () => setGuideDenied(true),
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 20000 },
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, [wantGps]);

  useEffect(() => {
    const map = mapRef.current;
    if (!wantGps || !map || !mapReady || !position || simulationPosition)
      return;
    let cancelled = false;
    void import('maplibre-gl').then((maplibregl) => {
      if (cancelled) return;
      if (userMarkerRef.current) {
        userMarkerRef.current.setLngLat([
          position.longitude,
          position.latitude,
        ]);
        return;
      }
      const element = document.createElement('div');
      element.className = 'user-location';
      userMarkerRef.current = new maplibregl.Marker({ element })
        .setLngLat([position.longitude, position.latitude])
        .addTo(map);
    });
    return () => {
      cancelled = true;
    };
  }, [wantGps, mapReady, position, simulationPosition]);

  // Extra spots that start a place's narration too (the pin is off the road, the place is not).
  const alsoNear = useMemo(() => {
    const bySlug = new Map(allPois.map((poi) => [poi.slug, poi.location]));
    const result: Record<string, GeoPoint[]> = {};
    for (const [slug, spots] of Object.entries(AUTO_TRIGGER_ALSO_NEAR)) {
      result[slug] = spots.flatMap((spot) => bySlug.get(spot) ?? []);
    }
    return result;
  }, [allPois]);

  // Everything the 1 s guide tick needs, kept in a ref so the tick never restarts.
  const guideLiveRef = useRef({
    simulationPosition,
    gpsFix,
    isWalking,
    targets: autoTargets,
    alsoNear,
    preferId: null as string | null,
  });
  guideLiveRef.current = {
    simulationPosition,
    gpsFix,
    isWalking,
    targets: autoTargets,
    alsoNear,
    preferId: route ? (selected?.id ?? null) : null,
  };
  const guideFix: GuideFix | null = simulationPosition
    ? {
        point: simulationPosition,
        accuracyMeters: SIMULATED_FIX_ACCURACY_METERS,
        atMs: Date.now(),
      }
    : gpsFix;
  // At most one place waits for the current audio to finish (the GPS never interrupts).
  const queuedGuideRef = useRef<PoiSummary | null>(null);
  const readingKeyRef = useRef('');

  /** Where the visitor is right now: the walker (also while it walks) or a fresh, usable GPS fix. */
  const readGuidePosition = useCallback((): GeoPoint | null => {
    const live = guideLiveRef.current;
    if (live.simulationPosition) {
      const at = simulationMarkerRef.current?.getLngLat();
      return at
        ? { latitude: at.lat, longitude: at.lng }
        : live.simulationPosition;
    }
    const fix = live.gpsFix;
    return fix &&
      Date.now() - fix.atMs <= AUTO_GUIDE_DEFAULTS.maxFixAgeMs &&
      fix.accuracyMeters <= AUTO_GUIDE_DEFAULTS.maxAccuracyMeters
      ? fix.point
      : null;
  }, []);
  const zoneGuide = useZoneGuide({
    enabled: autoGuide,
    player,
    playerIdle: playerState.status === 'idle',
    zones,
    places: allPois,
    narrationLocale,
    speechTag: speechTagFor(narrationCatalog, narrationLocale ?? 'vi'),
    welcomeTicket,
    readPosition: readGuidePosition,
    onNotInPark: () => setMessage(t.notInPark),
  });
  /** The visitor's Stop: ends the audio and drops what was waiting for it (the next place still plays). */
  function stopNarration() {
    player?.stop();
    queuedGuideRef.current = null;
    zoneGuide.clearQueue();
  }
  // A zone introduction (or the welcome) is being spoken: the cards offer a Stop button.
  const zoneSpeaking =
    playerState.active !== null &&
    playerState.active.poiId.startsWith('zone:') &&
    ['loading', 'playing', 'paused'].includes(playerState.active.status);
  // Whatever is being narrated shows in the panel with a Stop button, also when nothing else
  // would: a place that narrated by itself as the visitor walked by. Zone cards and the open
  // card of the same place carry their own Stop button.
  const active = playerState.active;
  const nowPlaying =
    active &&
    (active.status === 'loading' ||
      active.status === 'playing' ||
      active.status === 'paused') &&
    !(
      active.poiId.startsWith('zone:') &&
      (zoneGuide.card || zoneGuide.welcome)
    ) &&
    !(selected?.id === active.poiId && detailCardOpen)
      ? active
      : null;
  // The cards live in the left panel: open it and bring them into view when one appears.
  const zoneShown =
    zoneGuide.card?.id ??
    zoneGuide.welcome?.zone?.id ??
    (zoneGuide.welcome ? 'park' : null);
  useEffect(() => {
    if (!zoneShown) return;
    setPanelOpen(true);
    // After the intro text has folded away (its height transition), or the scroll lands too low.
    const timer = window.setTimeout(() => {
      const smooth = !window.matchMedia('(prefers-reduced-motion: reduce)')
        .matches;
      if (window.matchMedia('(max-width: 820px)').matches) {
        zoneCardsRef.current?.scrollIntoView({
          behavior: smooth ? 'smooth' : 'auto',
          block: 'start',
        });
      } else {
        panelRef.current?.scrollTo({
          top: 0,
          behavior: smooth ? 'smooth' : 'auto',
        });
      }
    }, 450);
    return () => window.clearTimeout(timer);
  }, [zoneShown]);

  // Measure visitor → place distance every second. The simulated walker counts as a fix, so
  // the flow is testable indoors. A place becomes a candidate after a short stay inside the
  // zone; what happens next (play / queue / already heard) is the player's call.
  useEffect(() => {
    if (!autoGuide || !player) return;
    const tick = () => {
      const live = guideLiveRef.current;
      if (live.targets.length === 0) return;
      const now = Date.now();
      // The walker counts while it walks too (its marker moves, its state does not).
      const walker = live.simulationPosition ? readGuidePosition() : null;
      const fix: GuideFix | null = walker
        ? {
            point: walker,
            accuracyMeters: SIMULATED_FIX_ACCURACY_METERS,
            atMs: now,
          }
        : live.gpsFix;
      if (!fix) return;
      const result = evaluateAutoGuide(
        guideStateRef.current,
        fix,
        live.targets.map((poi) => ({
          id: poi.id,
          location: poi.location,
          alsoNear: live.alsoNear[poi.slug],
        })),
        now,
        { preferId: live.preferId },
      );
      guideStateRef.current = result.state;
      let nearest: GuideReading['nearest'] = null;
      for (const poi of live.targets) {
        const distance = result.distances[poi.id]!;
        if (distance <= 300 && (!nearest || distance < nearest.distance)) {
          nearest = {
            name: poi.name,
            distance,
            near: distance <= AUTO_GUIDE_DEFAULTS.enterMeters,
          };
        }
      }
      const key = `${result.inaccurate}|${result.stale}|${Math.round(fix.accuracyMeters)}|${nearest?.name}|${nearest ? Math.round(nearest.distance / 5) : ''}`;
      if (key !== readingKeyRef.current) {
        readingKeyRef.current = key;
        setGuideReading({
          inaccurate: result.inaccurate,
          stale: result.stale,
          accuracyMeters: fix.accuracyMeters,
          nearest,
        });
      }
      const candidate = result.candidates[0];
      const poi = candidate
        ? live.targets.find((item) => item.id === candidate.id)
        : undefined;
      if (!poi) return;
      guideStateRef.current = markGuideFired(guideStateRef.current, poi.id);
      if (player.isBusy()) {
        queuedGuideRef.current = poi;
        return;
      }
      void requestPlayRef.current(poi, 'auto-gps').then((outcome) => {
        if (outcome === 'busy') queuedGuideRef.current = poi;
        if (outcome === 'played') setMessage(t.autoGuideArrived(poi.name));
      });
    };
    const timer = window.setInterval(tick, 1000);
    tick();
    return () => window.clearInterval(timer);
  }, [autoGuide, player, readGuidePosition, t]);

  // When the audio ends, the waiting place (if the visitor is still near it) gets its turn.
  useEffect(() => {
    if (!autoGuide || !player || playerState.status !== 'idle') return;
    const poi = queuedGuideRef.current;
    if (!poi) return;
    queuedGuideRef.current = null;
    // Re-check where the visitor is now: a stale or far-away fix means they moved on.
    const fix = readGuidePosition();
    if (
      !fix ||
      guideDistanceMeters(fix, {
        location: poi.location,
        alsoNear: guideLiveRef.current.alsoNear[poi.slug],
      }) > AUTO_GUIDE_DEFAULTS.exitMeters
    ) {
      return;
    }
    void requestPlayRef.current(poi, 'auto-gps').then((outcome) => {
      // Another introduction took the turn: keep waiting for the next end.
      if (outcome === 'busy') queuedGuideRef.current = poi;
      if (outcome === 'played') setMessage(t.autoGuideArrived(poi.name));
    });
  }, [autoGuide, player, playerState.status, readGuidePosition, t]);

  function toggleAutoGuide() {
    if (autoGuide) {
      setAutoGuide(false);
      player?.setAutoEnabled(false);
      queuedGuideRef.current = null;
      setGpsFix(null);
      setGuideReading(null);
      setGuideDenied(false);
      return;
    }
    // This tap is the user gesture that lets the browser play audio later.
    player?.unlock();
    window.speechSynthesis?.speak(new SpeechSynthesisUtterance(''));
    player?.setAutoEnabled(true);
    guideStateRef.current = EMPTY_GUIDE_STATE;
    readingKeyRef.current = '';
    setGuideDenied(false);
    setAutoGuide(true);
    setWelcomeTicket((count) => count + 1);
  }

  // Coming back to the app after a while (the phone was locked, another app was used): say
  // where the visitor is now and ask what they want next, like switching auto narration on.
  useEffect(() => {
    if (!autoGuide) return;
    let hiddenAt: number | null = null;
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') {
        hiddenAt = Date.now();
        return;
      }
      if (hiddenAt !== null && Date.now() - hiddenAt >= AWAY_WELCOME_MS) {
        setWelcomeTicket((count) => count + 1);
      }
      hiddenAt = null;
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [autoGuide]);

  /** An answer of the "what next" box: the nearest fitting place, and a route to it. */
  function chooseNextStop(kind: NextStopKind) {
    const from = readGuidePosition();
    zoneGuide.dismissWelcome();
    if (!from) return;
    const found = pickNextStop(kind, from, allPois);
    if (!found) {
      setMessage(t.nextNone);
      return;
    }
    setSelected(found.poi);
    setActiveChild(null);
    void navigateTo(found.poi).then(() =>
      setMessage(t.nextGoing(found.poi.name, Math.round(found.distance))),
    );
  }

  /** Explicit "new visit": forget what was heard so places narrate again. */
  function startNewVisit() {
    if (!player || !window.confirm(t.newVisitConfirm)) return;
    player.history.reset();
    player.touch();
    guideStateRef.current = EMPTY_GUIDE_STATE;
    queuedGuideRef.current = null;
  }

  /** Mirror the walker to face the way it moves on SCREEN (so a rotated map works too). */
  function faceWalkerAlong(
    coordinates: RouteResponse['geometry']['coordinates'],
    traveledMeters: number,
  ) {
    const map = mapRef.current;
    const element = simulationMarkerRef.current?.getElement();
    if (!map || !element) return;
    const here = routeProgressAt(coordinates, traveledMeters);
    const ahead = routeProgressAt(coordinates, traveledMeters + 4);
    if (!here || !ahead) return;
    const from = map.project([here.position.longitude, here.position.latitude]);
    const to = map.project([ahead.position.longitude, ahead.position.latitude]);
    const dx = to.x - from.x;
    // A near-vertical step keeps the last facing, so the sprite does not flicker.
    if (Math.abs(dx) < 0.6) return;
    element.style.setProperty('--facing', dx < 0 ? '-1' : '1');
  }

  function startAutomaticWalk(nextRoute: RouteResponse) {
    cancelSimulationAnimation();
    const coordinates = nextRoute.geometry.coordinates;
    const start = routeProgressAt(coordinates, 0);
    if (!start) {
      setMessage(t.routeNoGeometry);
      return;
    }

    const totalMeters = routeLengthMeters(coordinates);
    setSimulationPosition(start.position);
    setSimulationDistanceMeters(0);
    setArrivalOpen(false);
    setDetailCardOpen(false);
    setIsWalking(true);
    simulationMarkerRef.current?.setLngLat([
      start.position.longitude,
      start.position.latitude,
    ]);

    const durationMs = simulationDurationMs(totalMeters);
    const startedAt = performance.now();
    const animate = (now: number) => {
      const traveledMeters = simulationDistanceAtTime(
        totalMeters,
        now - startedAt,
        durationMs,
      );
      const progress = routeProgressAt(coordinates, traveledMeters);
      if (!progress) return;
      faceWalkerAlong(coordinates, progress.traveledMeters);

      setSimulationDistanceMeters(progress.traveledMeters);
      simulationMarkerRef.current?.setLngLat([
        progress.position.longitude,
        progress.position.latitude,
      ]);

      if (!progress.complete) {
        animationFrameRef.current = window.requestAnimationFrame(animate);
        return;
      }

      animationFrameRef.current = null;
      setSimulationPosition(progress.position);
      setIsWalking(false);
      setArrivalOpen(true);
      // Reaching the destination counts as the visitor arriving there (auto rules apply).
      const destination = selectedRef.current;
      if (destination) void requestPlayRef.current(destination, 'auto-gps');
    };
    animationFrameRef.current = window.requestAnimationFrame(animate);
  }

  function clearSimulation() {
    cancelSimulationAnimation();
    simulationMarkerRef.current?.remove();
    simulationMarkerRef.current = null;
    setSimulationPosition(null);
    setIsPickingSimulation(false);
    setSimulationDistanceMeters(0);
    setRoute(null);
    setArrivalOpen(false);
    setMessage('');
  }

  return (
    <main className="visitor-shell">
      <Header
        t={t}
        locale={locale}
        session={session}
        tools={
          <>
            <SimulationControls
              t={t}
              locale={locale}
              isPicking={isPickingSimulation}
              position={simulationPosition}
              progress={simulationProgress}
              route={route}
              selected={selected}
              isWalking={isWalking}
              onClear={clearSimulation}
              onPick={() => {
                cancelSimulationAnimation();
                setIsPickingSimulation(true);
                setMessage(t.simulationPickHint);
              }}
              onReplay={() => {
                if (route) startAutomaticWalk(route);
              }}
            />
            <button
              type="button"
              className="locate-button"
              aria-label={t.locateMe.replace(/^◎\s*/, '')}
              onClick={() =>
                void locate().catch((error: Error) => setMessage(error.message))
              }
            >
              <span aria-hidden="true">◎</span>
              <span className="locate-label">
                {t.locateMe.replace(/^◎\s*/, '')}
              </span>
            </button>
          </>
        }
        onLocaleChange={changeLocale}
        onLogin={() => setAuthMode('login')}
        onLogout={() => {
          clearVisitorSession();
          setSession(null);
        }}
      />
      <section
        className={`workspace${panelOpen ? '' : ' panel-closed'}`}
        id="top"
      >
        <aside
          className="discovery-panel"
          id="discovery-panel"
          ref={panelRef}
          aria-hidden={!panelOpen}
          inert={!panelOpen}
        >
          <div className="discovery-inner">
            <div
              className={`collapse${(selected && detailCardOpen) || zoneGuide.card || zoneGuide.welcome ? ' is-collapsed' : ''}`}
            >
              <div className="collapse-inner">
                <div className="intro">
                  <p className="eyebrow">{t.eyebrow}</p>
                  <h1>
                    {t.heroLine1}
                    <br />
                    {t.heroLine2}
                  </h1>
                  <p>{t.heroBody}</p>
                </div>
              </div>
            </div>
            <label className="search-box">
              <span>⌕</span>
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t.searchPlaceholder}
                aria-label={t.searchLabel}
              />
            </label>
            {nowPlaying ? (
              <NowPlayingCard
                t={t}
                name={nowPlaying.poiName}
                status={nowPlaying.status as 'loading' | 'playing' | 'paused'}
                canPause={nowPlaying.engine === 'audio'}
                onPause={() => player?.pause()}
                onResume={() => player?.resume()}
                onStop={stopNarration}
                onOpen={
                  nowPlaying.poiId.startsWith('zone:')
                    ? undefined
                    : () => {
                        const poi =
                          pois.find((item) => item.id === nowPlaying.poiId) ??
                          allPois.find((item) => item.id === nowPlaying.poiId);
                        if (poi) openPoi(poi);
                      }
                }
              />
            ) : null}
            <div ref={zoneCardsRef} className="zone-stack">
              {zoneGuide.welcome ? (
                <NextStopBox
                  t={t}
                  locale={locale}
                  zone={zoneGuide.welcome.zone}
                  speaking={zoneSpeaking}
                  onStop={stopNarration}
                  onChoose={chooseNextStop}
                  onClose={zoneGuide.dismissWelcome}
                />
              ) : null}
              {zoneGuide.card ? (
                <ZoneCard
                  t={t}
                  locale={locale}
                  zone={zoneGuide.card}
                  speaking={zoneSpeaking}
                  onStop={stopNarration}
                  onClose={zoneGuide.dismissCard}
                />
              ) : null}
            </div>
            {selected && detailCardOpen ? (
              <PoiDetailCard
                cardRef={detailRef}
                t={t}
                locale={locale}
                detail={detail}
                subPlaces={selectedChildren}
                activeChild={activeChild}
                onChildSelect={setActiveChild}
                narrationSection={
                  <NarrationSection
                    t={t}
                    catalog={narrationCatalog}
                    catalogStatus={narrationCatalogStatus}
                    narrationLocale={narrationLocale}
                    narration={narration}
                    status={narrationStatus}
                    speechSupported={speechSupported}
                    playback={{
                      status:
                        playerState.active?.poiId === selected.id
                          ? playerState.active.status
                          : playerState.pending?.poiId === selected.id
                            ? 'loading'
                            : 'idle',
                      heard: Boolean(
                        narration &&
                          player?.isHeard(
                            narrationKey(
                              selected.id,
                              narration.resolvedLocale,
                              narration.id,
                            ),
                          ),
                      ),
                    }}
                    onLocaleChange={setNarrationLocale}
                    onRetry={retryNarration}
                    onRetryCatalog={retryNarrationCatalog}
                    onListen={() => void requestPlay(selected, 'manual')}
                    onPause={() => player?.pause()}
                    onResume={() => player?.resume()}
                    onStop={stopNarration}
                  />
                }
                route={route}
                selected={selected}
                hasSimulation={Boolean(simulationPosition)}
                onClose={() => setDetailCardOpen(false)}
                onNavigate={() => void navigateToSelected()}
              />
            ) : null}
            <AutoGuidePanel
              t={t}
              locale={locale}
              enabled={autoGuide}
              denied={guideDenied}
              hasFix={guideFix !== null}
              reading={guideReading}
              eligibleCount={autoTargets.length}
              heardCount={player?.history.size ?? 0}
              onToggle={toggleAutoGuide}
              onNewVisit={startNewVisit}
            />
            <div className="list-heading">
              <strong>{query ? t.searchResults : t.placesHeading}</strong>
              <span>{t.placeCount(pois.length)}</span>
            </div>
            <div className="poi-list">
              {loading ? (
                <div className="empty-state">{t.loadingPlaces}</div>
              ) : null}
              {!loading && pois.length === 0 ? (
                <div className="empty-state">{t.noPlaces}</div>
              ) : null}
              {pois.map((poi) => (
                <button
                  className={`poi-card${selected?.id === poi.id ? ' active' : ''}`}
                  key={poi.id}
                  onClick={() => openPoi(poi)}
                >
                  <PoiIndex slug={poi.slug} />
                  <span className="poi-copy">
                    <strong>{poi.name}</strong>
                    <small>
                      {categoryLabel(poi.category, locale)}
                      {poi.distanceMeters === undefined
                        ? ''
                        : ` · ${formatDistance(poi.distanceMeters, locale)}`}
                    </small>
                  </span>
                  <span className="poi-arrow">→</span>
                </button>
              ))}
            </div>
          </div>
        </aside>

        <section
          ref={mapPanelRef}
          className={`map-panel${isPickingSimulation ? ' is-picking-human' : ''}`}
          aria-label={t.mapLabel}
        >
          <div className="map-canvas" ref={mapContainerRef} />
          <button
            type="button"
            className="panel-handle"
            aria-expanded={panelOpen}
            aria-controls="discovery-panel"
            aria-label={panelOpen ? t.hidePanel : t.showPanel}
            title={panelOpen ? t.hidePanel : t.showPanel}
            onClick={togglePanel}
          >
            <span aria-hidden="true">{panelOpen ? '‹' : '›'}</span>
          </button>
          {clusterMenu ? (
            <div
              className="cluster-menu"
              role="dialog"
              aria-label={t.clusterMenuLabel}
              style={{
                left: Math.max(8, clusterMenu.x - 110),
                top: Math.max(8, clusterMenu.y + 20),
              }}
            >
              <strong>{t.clusterMenuLabel}</strong>
              <ul>
                {pois
                  .filter((poi) => clusterMenu.ids.includes(poi.id))
                  .map((poi) => (
                    <li key={poi.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setClusterMenu(null);
                          openPoi(poi);
                        }}
                      >
                        <PoiIndex slug={poi.slug} />
                        <span>{poi.name}</span>
                      </button>
                    </li>
                  ))}
              </ul>
            </div>
          ) : null}
          {illustratedReady ? (
            <div className="map-kind" role="group" aria-label={t.mapKindLabel}>
              {(
                [
                  ['old', t.mapOld],
                  ['new', t.mapNew],
                ] as const
              ).map(([kind, label]) => (
                <button
                  key={kind}
                  type="button"
                  className={mapKind === kind ? 'active' : ''}
                  aria-pressed={mapKind === kind}
                  onClick={() => setMapKind(kind)}
                >
                  {label}
                </button>
              ))}
            </div>
          ) : null}
          <AudioBar t={t} active={playerState.active} />
          <CameraControls
            t={t}
            locale={locale}
            mode={camera.mode}
            remainingMeters={camera.progress?.remainingMeters ?? null}
            waiting={camera.waitingForFix && simulationPosition === null}
            onFollow={camera.followMe}
            onOverview={camera.showOverview}
            onStop={stopGuidance}
          />
          {message ? <div className="toast">{message}</div> : null}
        </section>
      </section>

      {authMode ? (
        <AuthDialog
          t={t}
          mode={authMode}
          locale={locale}
          onClose={() => setAuthMode(null)}
          onModeChange={setAuthMode}
          onAuthenticated={(next) => {
            saveVisitorSession(next);
            setSession(next);
            setAuthMode(null);
          }}
        />
      ) : null}
      {arrivalOpen && selected ? (
        <ArrivalDialog
          t={t}
          narration={narration}
          catalog={narrationCatalog}
          poiName={detail?.name ?? selected.name}
          canPlay={speechSupported || Boolean(narration?.audio)}
          onClose={() => {
            stopPlayback();
            setArrivalOpen(false);
          }}
          onReplay={() => void requestPlay(selected, 'manual')}
          onStop={stopPlayback}
        />
      ) : null}
    </main>
  );
}

function AutoGuidePanel({
  t,
  locale,
  enabled,
  denied,
  hasFix,
  reading,
  eligibleCount,
  heardCount,
  onToggle,
  onNewVisit,
}: {
  t: UiText;
  locale: UiLocale;
  enabled: boolean;
  denied: boolean;
  hasFix: boolean;
  reading: GuideReading | null;
  eligibleCount: number;
  heardCount: number;
  onToggle(): void;
  onNewVisit(): void;
}) {
  if (eligibleCount === 0) return null;
  // The switch being on is not "ready": say what is missing (position, permission, accuracy).
  let status = '';
  if (enabled) {
    if (denied && !hasFix) status = t.autoGuideDenied;
    else if (!hasFix || !reading || reading.stale) {
      status = reading?.stale ? t.autoGuideStale : t.autoGuideWaiting;
    } else if (reading.inaccurate) {
      status = t.autoGuideInaccurate(Math.round(reading.accuracyMeters));
    } else if (reading.nearest) {
      status = reading.nearest.near
        ? `${t.autoGuideNear}: ${reading.nearest.name}`
        : t.autoGuideNearest(
            reading.nearest.name,
            formatDistance(reading.nearest.distance, locale),
          );
    }
  }
  return (
    <section className="auto-guide" aria-label={t.autoGuideTitle}>
      <div className="auto-guide-head">
        <strong>{t.autoGuideTitle}</strong>
        <button
          type="button"
          className={`auto-guide-toggle${enabled ? ' on' : ''}`}
          aria-pressed={enabled}
          onClick={onToggle}
        >
          {enabled ? t.autoGuideDisable : t.autoGuideEnable}
        </button>
      </div>
      {enabled ? null : <p>{t.autoGuideHint}</p>}
      <p className="auto-guide-count">{t.autoGuideCount(eligibleCount)}</p>
      {status ? <p role="status">{status}</p> : null}
      {heardCount > 0 ? (
        <div className="auto-guide-visit">
          <small>{t.heardCount(heardCount)}</small>
          <button type="button" className="inline-action" onClick={onNewVisit}>
            {t.newVisit}
          </button>
        </div>
      ) : null}
    </section>
  );
}

function Header({
  tools,
  t,
  locale,
  session,
  onLocaleChange,
  onLogin,
  onLogout,
}: {
  /** Map tools (simulated walker, my location) shown in the middle of the header. */
  tools: React.ReactNode;
  t: UiText;
  locale: UiLocale;
  session: AuthResponse | null;
  onLocaleChange(locale: UiLocale): void;
  onLogin(): void;
  onLogout(): void;
}) {
  return (
    <header className="topbar">
      <a className="brand" href="#top" aria-label="Đầm Sen Smart Guide">
        <span className="brand-mark">DS</span>
        <span>
          <strong>Đầm Sen</strong>
          <small>Smart Guide</small>
        </span>
      </a>
      <div className="top-tools">{tools}</div>
      <div className="top-actions">
        <div
          className="locale-switch"
          role="group"
          aria-label={t.localeGroupLabel}
        >
          <button
            type="button"
            className={locale === 'vi' ? 'active' : ''}
            aria-pressed={locale === 'vi'}
            aria-label="Giao diện tiếng Việt"
            onClick={() => onLocaleChange('vi')}
          >
            VI
          </button>
          <button
            type="button"
            className={locale === 'en' ? 'active' : ''}
            aria-pressed={locale === 'en'}
            aria-label="Interface in English"
            onClick={() => onLocaleChange('en')}
          >
            EN
          </button>
        </div>
        {session ? (
          <button className="account-button" onClick={onLogout}>
            {session.user.email.split('@')[0]} · {t.logout}
          </button>
        ) : (
          <button className="account-button" onClick={onLogin}>
            {t.login}
          </button>
        )}
      </div>
    </header>
  );
}

/** Number of a place in the lists; the icon for a service point. */
function PoiIndex({ slug }: { slug: string }) {
  const kind = amenityKind(slug);
  return kind ? (
    <span className="poi-index icon">
      <img src={amenityIconUrl(kind)} alt="" width={26} height={26} />
    </span>
  ) : (
    <span className="poi-index">{formatPoiNumber(slug)}</span>
  );
}

function PoiDetailCard({
  cardRef,
  t,
  locale,
  detail,
  subPlaces,
  activeChild,
  onChildSelect,
  narrationSection,
  route,
  selected,
  hasSimulation,
  onClose,
  onNavigate,
}: {
  cardRef: React.Ref<HTMLElement>;
  t: UiText;
  locale: UiLocale;
  detail: PoiDetail | null;
  subPlaces: SubPlace[];
  activeChild: number | null;
  onChildSelect(index: number): void;
  narrationSection: React.ReactNode;
  route: RouteResponse | null;
  selected: PoiSummary;
  hasSimulation: boolean;
  onClose(): void;
  onNavigate(): void;
}) {
  return (
    <article className="poi-detail" ref={cardRef}>
      <button className="close-button" onClick={onClose} aria-label={t.close}>
        ×
      </button>
      <p className="eyebrow">{categoryLabel(selected.category, locale)}</p>
      <h2>{detail?.name ?? selected.name}</h2>
      <p>{detail?.longDescription ?? selected.shortDescription}</p>
      {subPlaces.length > 0 ? (
        <section className="sub-places" aria-label={t.subPlacesHeading}>
          <h3>
            {t.subPlacesHeading}
            <span>{t.subPlaceCount(subPlaces.length)}</span>
          </h3>
          <ul>
            {subPlaces.map((child, index) => (
              <li key={index}>
                <button
                  type="button"
                  className={activeChild === index ? 'active' : ''}
                  aria-pressed={activeChild === index}
                  onClick={() => onChildSelect(index)}
                >
                  {child.pin ? (
                    <span className={`sub-dot pin-${child.color ?? 'white'}`}>
                      {child.pin}
                    </span>
                  ) : (
                    <span className="sub-dot none" aria-hidden="true" />
                  )}
                  {subPlaceName(child, locale)}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {narrationSection}
      {route ? (
        <div className="route-summary">
          <strong>{formatDistance(route.distanceMeters, locale)}</strong>
          <span>{t.routeAbout(formatDuration(route.etaSeconds, locale))}</span>
          <ol>
            {route.steps.map((step) => (
              <li key={step.sequence}>{step.instruction}</li>
            ))}
          </ol>
        </div>
      ) : null}
      <button className="primary-action" onClick={onNavigate}>
        {route
          ? t.updateRoute
          : hasSimulation
            ? t.routeFromWalker
            : t.routeFromMe}
      </button>
    </article>
  );
}

function SimulationControls({
  t,
  locale,
  isPicking,
  isWalking,
  position,
  progress,
  route,
  selected,
  onClear,
  onPick,
  onReplay,
}: {
  t: UiText;
  locale: UiLocale;
  isPicking: boolean;
  isWalking: boolean;
  position: GeoPoint | null;
  progress: RouteProgress | null;
  route: RouteResponse | null;
  selected: PoiSummary | null;
  onClear(): void;
  onPick(): void;
  onReplay(): void;
}) {
  const [isCollapsed, setIsCollapsed] = useState(true);
  const rootRef = useRef<HTMLElement>(null);
  // The panel drops down from the header: a click elsewhere or Escape folds it again.
  useEffect(() => {
    if (isCollapsed) return;
    const close = (event: Event) => {
      if (
        event.type === 'keydown' &&
        (event as KeyboardEvent).key !== 'Escape'
      ) {
        return;
      }
      if (
        event.type === 'pointerdown' &&
        rootRef.current?.contains(event.target as Node)
      ) {
        return;
      }
      setIsCollapsed(true);
    };
    document.addEventListener('pointerdown', close);
    document.addEventListener('keydown', close);
    return () => {
      document.removeEventListener('pointerdown', close);
      document.removeEventListener('keydown', close);
    };
  }, [isCollapsed]);
  const progressPercent = progress?.totalMeters
    ? Math.round((progress.traveledMeters / progress.totalMeters) * 100)
    : 0;

  return (
    <section
      ref={rootRef}
      className={`simulation-controls${isCollapsed ? ' is-collapsed' : ''}`}
      aria-label={t.simulationLabel}
    >
      <button
        className="simulation-toggle"
        type="button"
        aria-expanded={!isCollapsed}
        aria-label={isCollapsed ? t.openSimulation : t.collapseSimulation}
        onClick={() => setIsCollapsed((value) => !value)}
      >
        {isCollapsed ? '⌄' : '⌃'}
      </button>
      <div className="simulation-heading">
        <span className="human-icon indie-mascot-icon" aria-hidden="true">
          ✦
        </span>
        <span>
          <strong>{t.simulatedWalker}</strong>
          <small>
            {isWalking
              ? t.walking(progressPercent)
              : position
                ? route
                  ? t.remaining(
                      formatDistance(progress?.remainingMeters, locale),
                    )
                  : t.placedOnMap
                : t.noPosition}
          </small>
        </span>
      </div>
      <div className="simulation-body">
        <button
          className={`simulation-pick${isPicking ? ' active' : ''}`}
          onClick={() => {
            onPick();
            setIsCollapsed(true);
          }}
        >
          {isPicking
            ? t.clickMap
            : position
              ? t.repositionWalker
              : t.placeWalker}
        </button>
        {position ? (
          <>
            {route ? (
              <div className="simulation-progress" aria-label={t.progressLabel}>
                <span style={{ width: `${progressPercent}%` }} />
              </div>
            ) : null}
            <button
              className="simulation-step"
              disabled={!route || isWalking}
              onClick={() => {
                onReplay();
                setIsCollapsed(true);
              }}
            >
              {isWalking
                ? t.walking(progressPercent)
                : route
                  ? progress?.complete
                    ? t.walkAgain
                    : t.startWalking
                  : selected
                    ? t.createRouteInCard
                    : t.choosePoi}
            </button>
            <button className="simulation-clear" onClick={onClear}>
              {t.clearSimulation}
            </button>
          </>
        ) : null}
      </div>
    </section>
  );
}

/** "Follow me" / "Whole route" / "Stop": what the visitor can ask of the camera while guided. */
function CameraControls({
  t,
  locale,
  mode,
  remainingMeters,
  waiting,
  onFollow,
  onOverview,
  onStop,
}: {
  t: UiText;
  locale: UiLocale;
  mode: CameraMode;
  remainingMeters: number | null;
  waiting: boolean;
  onFollow(): void;
  onOverview(): void;
  onStop(): void;
}) {
  if (mode === 'explore') return null;
  return (
    <div className="camera-controls" role="group" aria-label={t.cameraLabel}>
      {waiting && mode !== 'arrived' ? (
        <span className="camera-remaining" role="status">
          {t.autoGuideWaiting}
        </span>
      ) : null}
      {remainingMeters !== null && mode !== 'arrived' ? (
        <span className="camera-remaining">
          {t.remaining(formatDistance(remainingMeters, locale))}
        </span>
      ) : null}
      {mode === 'free' || mode === 'overview' ? (
        <button type="button" onClick={onFollow}>
          {t.followMe}
        </button>
      ) : null}
      {mode === 'follow' || mode === 'free' ? (
        <button type="button" onClick={onOverview}>
          {t.fullRoute}
        </button>
      ) : null}
      <button type="button" className="camera-stop" onClick={onStop}>
        {t.stopGuidance}
      </button>
    </div>
  );
}

function ArrivalDialog({
  t,
  narration,
  catalog,
  poiName,
  canPlay,
  onClose,
  onReplay,
  onStop,
}: {
  t: UiText;
  narration: PoiNarration | null;
  catalog: NarrationLocaleCatalog;
  poiName: string;
  canPlay: boolean;
  onClose(): void;
  onReplay(): void;
  onStop(): void;
}) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        className="arrival-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="arrival-title"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button className="close-button" onClick={onClose} aria-label={t.close}>
          ×
        </button>
        <div className="arrival-icon" aria-hidden="true">
          ✓
        </div>
        <p className="eyebrow">{t.arrived}</p>
        <h2 id="arrival-title">{poiName}</h2>
        {narration?.fallbackUsed ? (
          <p className="fallback-notice" role="status">
            {t.usingFallback(
              localeLabel(catalog, narration.resolvedLocale),
              localeLabel(catalog, narration.requestedLocale),
            )}
          </p>
        ) : null}
        <p lang={narration?.resolvedLocale}>
          {narration?.transcript ?? t.noApprovedNarration}
        </p>
        {canPlay ? (
          <div className="arrival-actions">
            <button className="primary-action" onClick={onReplay}>
              {t.replayNarration}
            </button>
            <button className="secondary-action" onClick={onStop}>
              {t.stopReading}
            </button>
          </div>
        ) : (
          <small className="muted">{t.noAudioNoSpeech}</small>
        )}
      </section>
    </div>
  );
}

function AuthDialog({
  t,
  mode,
  locale,
  onAuthenticated,
  onClose,
  onModeChange,
}: {
  t: UiText;
  mode: AuthMode;
  locale: UiLocale;
  onAuthenticated(session: AuthResponse): void;
  onClose(): void;
  onModeChange(mode: AuthMode): void;
}) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError('');
    try {
      const response =
        mode === 'login'
          ? await visitorApi.login({ email, password })
          : await visitorApi.register({
              email,
              password,
              preferredLocale: contentLocale(locale),
            });
      onAuthenticated(response);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t.authFailed);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <form
        className="auth-dialog"
        onSubmit={submit}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          className="close-button"
          onClick={onClose}
          aria-label={t.close}
        >
          ×
        </button>
        <p className="eyebrow">{t.accountEyebrow}</p>
        <h2>{mode === 'login' ? t.welcomeBack : t.createAccount}</h2>
        <p>{t.guestNote}</p>
        <label>
          {t.email}
          <input
            required
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </label>
        <label>
          {t.password}
          <input
            required
            minLength={10}
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </label>
        {error ? <div className="form-error">{error}</div> : null}
        <button className="primary-action" disabled={loading} type="submit">
          {loading ? t.working : mode === 'login' ? t.login : t.signUp}
        </button>
        <button
          type="button"
          className="text-action"
          onClick={() => onModeChange(mode === 'login' ? 'register' : 'login')}
        >
          {mode === 'login' ? t.noAccount : t.haveAccount}
        </button>
      </form>
    </div>
  );
}
