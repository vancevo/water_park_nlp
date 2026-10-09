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
import { useCallback, useEffect, useRef, useState } from 'react';
import { visitorApi } from '@/lib/api';
import {
  addMapPictures,
  pictureLayerId,
  type AddedPicture,
} from '@/lib/map-pictures';
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
  routeLengthMeters,
  routeProgressAt,
  simulationDistanceAtTime,
  type RouteProgress,
} from '@/lib/route-simulation';
import {
  pickSpeechVoice,
  localeLabel,
  speechTagFor,
} from '@/lib/narration-locales';
import {
  clearVisitorSession,
  readVisitorSession,
  saveVisitorSession,
} from '@/lib/session';
import { NarrationSection, useVisitorNarration } from './narration-section';

const FALLBACK_CENTER: [number, number] = [106.63853, 10.76433];
type MapKind = 'old' | 'new' | 'overlay';
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

export function VisitorExperience() {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapPanelRef = useRef<HTMLElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef<Marker[]>([]);
  const userMarkerRef = useRef<Marker | null>(null);
  const simulationMarkerRef = useRef<Marker | null>(null);
  const animationFrameRef = useRef<number | null>(null);
  const narrationSpeakerRef = useRef<() => void>(() => {});
  const narrationAudioRef = useRef<HTMLAudioElement | null>(null);
  const [mapReady, setMapReady] = useState(false);
  const [mapKind, setMapKind] = useState<MapKind>('old');
  const [illustratedOpacity, setIllustratedOpacity] = useState(0.55);
  const [pictures, setPictures] = useState<AddedPicture[]>([]);
  const [pictureId, setPictureId] = useState('');
  const [locale, setLocaleState] = useState<UiLocale>('vi');
  const t = uiText(locale);
  const changeLocale = useCallback((next: UiLocale) => {
    setLocaleState(next);
    saveUiLocalePreference(next);
  }, []);
  const [pois, setPois] = useState<PoiSummary[]>([]);
  const [selected, setSelected] = useState<PoiSummary | null>(null);
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
  const [arrivalOpen, setArrivalOpen] = useState(false);
  const [speechSupported, setSpeechSupported] = useState(false);
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

  /**
   * Stops browser TTS and every narration audio: the programmatic player used
   * by replay/arrival and the inline `<audio controls>` in the POI card, so two
   * narrations never play over each other.
   */
  const stopPlayback = useCallback(() => {
    window.speechSynthesis?.cancel();
    narrationAudioRef.current?.pause();
    document
      .querySelectorAll<HTMLAudioElement>('audio')
      .forEach((audio) => audio.pause());
  }, []);

  const openPoi = useCallback(
    (poi: PoiSummary) => {
      cancelSimulationAnimation();
      stopPlayback();
      setSelected(poi);
      setDetailCardOpen(true);
      // On phones the list is below the map: bring the detail card into view.
      if (window.matchMedia('(max-width: 820px)').matches) {
        mapPanelRef.current?.scrollIntoView({
          behavior: window.matchMedia('(prefers-reduced-motion: reduce)')
            .matches
            ? 'auto'
            : 'smooth',
          block: 'start',
        });
      }
    },
    [cancelSimulationAnimation, stopPlayback],
  );

  useEffect(() => setSession(readVisitorSession()), []);

  useEffect(() => {
    setSpeechSupported(
      'speechSynthesis' in window && 'SpeechSynthesisUtterance' in window,
    );
    return () => {
      stopPlayback();
      cancelSimulationAnimation();
    };
  }, [cancelSimulationAnimation, stopPlayback]);

  // Changing narration language or POI must not keep playing the old audio.
  useEffect(() => stopPlayback(), [narrationLocale, selected, stopPlayback]);

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
      setPois(response.items);
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
          data: '/data/damsen-osm-walkways.geojson',
          attribution: '© OpenStreetMap contributors',
        });
        void addMapPictures(map).then((added) => {
          setPictures(added);
          setPictureId((current) =>
            added.some((picture) => picture.id === current)
              ? current
              : (added[0]?.id ?? ''),
          );
        });
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
      markersRef.current.forEach((marker) => marker.remove());
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

  // Old map = OSM base + walkways; new = the chosen picture; overlay = both.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    for (const { id } of pictures) {
      const layer = pictureLayerId(id);
      if (!map.getLayer(layer)) continue;
      const shown = mapKind !== 'old' && id === pictureId;
      map.setLayoutProperty(layer, 'visibility', shown ? 'visible' : 'none');
      map.setPaintProperty(
        layer,
        'raster-opacity',
        mapKind === 'new' ? 1 : illustratedOpacity,
      );
    }
  }, [illustratedOpacity, mapKind, mapReady, pictureId, pictures]);

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
      setSimulationPosition({
        latitude: event.lngLat.lat,
        longitude: event.lngLat.lng,
      });
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

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    let cancelled = false;
    void import('maplibre-gl').then((maplibregl) => {
      if (cancelled) return;
      markersRef.current.forEach((marker) => marker.remove());
      markersRef.current = pois.map((poi, index) => {
        const element = document.createElement('button');
        element.className = `map-pin${selected?.id === poi.id ? ' selected' : ''}`;
        element.type = 'button';
        element.ariaLabel = poi.name;
        element.innerHTML = `<span>${index + 1}</span>`;
        element.addEventListener('click', () => openPoi(poi));
        return new maplibregl.Marker({ element })
          .setLngLat([poi.location.longitude, poi.location.latitude])
          .addTo(map);
      });
    });
    return () => {
      cancelled = true;
    };
  }, [mapReady, openPoi, pois, selected?.id]);

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
      element.append(spriteWindow, shadow);
      simulationMarkerRef.current = new maplibregl.Marker({
        element,
        anchor: 'bottom',
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
    stopPlayback();
    mapRef.current?.flyTo({
      center: [selected.location.longitude, selected.location.latitude],
      zoom: 17.2,
    });
    void visitorApi
      .getPoi(selected.id, contentLocale(locale))
      .then(setDetail)
      .catch(() => {});
  }, [cancelSimulationAnimation, locale, selected, stopPlayback]);

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
    const coordinates = route.geometry.coordinates;
    const first = coordinates.at(0);
    const last = coordinates.at(-1);
    if (first && last && !simulationPosition) {
      map.fitBounds([first, last], {
        padding: 90,
        maxZoom: 18,
      });
    }
  }, [mapReady, route, simulationPosition]);

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
    if (!selected) return;
    cancelSimulationAnimation();
    setMessage('');
    try {
      const origin = simulationPosition ?? position ?? (await locate());
      const result = await visitorApi.createRoute({
        from: { lat: origin.latitude, lng: origin.longitude },
        poiId: selected.id,
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

  /**
   * Audio first: recorded/published audio wins over browser TTS. Web Speech
   * uses the catalog speechTag and never reads a transcript with a voice of
   * another language; the transcript stays visible either way.
   */
  const speakNarration = useCallback(() => {
    stopPlayback();
    if (narration?.audio) {
      const audio = narrationAudioRef.current ?? new Audio();
      narrationAudioRef.current = audio;
      if (audio.src !== narration.audio.playbackUrl)
        audio.src = narration.audio.playbackUrl;
      audio.currentTime = 0;
      void audio.play().catch(() => setMessage(t.autoplayBlocked));
      return;
    }
    if (!speechSupported) {
      setMessage(t.speechUnsupported);
      return;
    }
    const text =
      narration?.transcript ??
      detail?.longDescription ??
      selected?.shortDescription;
    if (!text) {
      setMessage(t.noNarrationToPlay);
      return;
    }
    // Without narration the text is POI content in the UI locale.
    const textLocale = narration?.resolvedLocale ?? contentLocale(locale);
    const speechTag = speechTagFor(narrationCatalog, textLocale);
    const voices = window.speechSynthesis.getVoices();
    const voice = pickSpeechVoice(voices, speechTag);
    if (voices.length > 0 && !voice) {
      setMessage(t.noVoice(localeLabel(narrationCatalog, textLocale)));
      return;
    }
    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = speechTag;
    if (voice) utterance.voice = voice;
    utterance.rate = 0.95;
    window.speechSynthesis.speak(utterance);
  }, [
    detail,
    locale,
    narration,
    narrationCatalog,
    selected,
    speechSupported,
    stopPlayback,
    t,
  ]);

  useEffect(() => {
    narrationSpeakerRef.current = speakNarration;
  }, [speakNarration]);

  function startAutomaticWalk(nextRoute: RouteResponse) {
    cancelSimulationAnimation();
    stopPlayback();
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

    const startedAt = performance.now();
    const animate = (now: number) => {
      const traveledMeters = simulationDistanceAtTime(
        totalMeters,
        now - startedAt,
      );
      const progress = routeProgressAt(coordinates, traveledMeters);
      if (!progress) return;

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
      narrationSpeakerRef.current();
    };
    animationFrameRef.current = window.requestAnimationFrame(animate);
  }

  function clearSimulation() {
    cancelSimulationAnimation();
    stopPlayback();
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
        onLocaleChange={changeLocale}
        onLogin={() => setAuthMode('login')}
        onLogout={() => {
          clearVisitorSession();
          setSession(null);
        }}
      />
      <section className="workspace" id="top">
        <aside className="discovery-panel">
          <div className="intro">
            <p className="eyebrow">{t.eyebrow}</p>
            <h1>
              {t.heroLine1}
              <br />
              {t.heroLine2}
            </h1>
            <p>{t.heroBody}</p>
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
            {pois.map((poi, index) => (
              <button
                className={`poi-card${selected?.id === poi.id ? ' active' : ''}`}
                key={poi.id}
                onClick={() => openPoi(poi)}
              >
                <span className="poi-index">
                  {String(index + 1).padStart(2, '0')}
                </span>
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
        </aside>

        <section
          ref={mapPanelRef}
          className={`map-panel${isPickingSimulation ? ' is-picking-human' : ''}`}
          aria-label={t.mapLabel}
        >
          <div className="map-canvas" ref={mapContainerRef} />
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
            className="locate-button"
            onClick={() =>
              void locate().catch((error: Error) => setMessage(error.message))
            }
          >
            {t.locateMe}
          </button>
          <div className="research-badge">{t.researchBadge}</div>
          <div className="map-kind" role="group" aria-label={t.mapKindLabel}>
            {(
              [
                ['old', t.mapOld],
                ['new', t.mapNew],
                ['overlay', t.mapOverlay],
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
            {mapKind === 'overlay' ? (
              <label className="map-opacity">
                <span>{t.mapOpacity}</span>
                <input
                  type="range"
                  min={0.1}
                  max={0.9}
                  step={0.05}
                  value={illustratedOpacity}
                  onChange={(event) =>
                    setIllustratedOpacity(Number(event.target.value))
                  }
                />
              </label>
            ) : null}
            {mapKind !== 'old' && pictures.length > 1 ? (
              <label className="map-picture">
                <span>{t.mapPicture}</span>
                <select
                  value={pictureId}
                  onChange={(event) => setPictureId(event.target.value)}
                >
                  {pictures.map(({ id }) => (
                    <option key={id} value={id}>
                      {t.mapPictureNames[id] ?? id}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}
            {mapKind !== 'old' ? (
              <small className="map-note">
                {pictures.find((picture) => picture.id === pictureId)
                  ?.confidence === 'fitted'
                  ? t.mapFitted
                  : t.mapExperimental}
              </small>
            ) : null}
          </div>
          {message ? <div className="toast">{message}</div> : null}
          {selected && detailCardOpen ? (
            <PoiDetailCard
              t={t}
              locale={locale}
              detail={detail}
              narrationSection={
                <NarrationSection
                  t={t}
                  catalog={narrationCatalog}
                  catalogStatus={narrationCatalogStatus}
                  narrationLocale={narrationLocale}
                  narration={narration}
                  status={narrationStatus}
                  speechSupported={speechSupported}
                  onLocaleChange={setNarrationLocale}
                  onRetry={retryNarration}
                  onRetryCatalog={retryNarrationCatalog}
                  onSpeak={speakNarration}
                />
              }
              route={route}
              selected={selected}
              hasSimulation={Boolean(simulationPosition)}
              onClose={() => setDetailCardOpen(false)}
              onNavigate={() => void navigateToSelected()}
            />
          ) : null}
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
          onReplay={speakNarration}
          onStop={stopPlayback}
        />
      ) : null}
    </main>
  );
}

function Header({
  t,
  locale,
  session,
  onLocaleChange,
  onLogin,
  onLogout,
}: {
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
          <button
            type="button"
            className={locale === 'fr' ? 'active' : ''}
            aria-pressed={locale === 'fr'}
            aria-label="Interface en français"
            onClick={() => onLocaleChange('fr')}
          >
            FR
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

function PoiDetailCard({
  t,
  locale,
  detail,
  narrationSection,
  route,
  selected,
  hasSimulation,
  onClose,
  onNavigate,
}: {
  t: UiText;
  locale: UiLocale;
  detail: PoiDetail | null;
  narrationSection: React.ReactNode;
  route: RouteResponse | null;
  selected: PoiSummary;
  hasSimulation: boolean;
  onClose(): void;
  onNavigate(): void;
}) {
  return (
    <article className="poi-detail">
      <button className="close-button" onClick={onClose} aria-label={t.close}>
        ×
      </button>
      <p className="eyebrow">{categoryLabel(selected.category, locale)}</p>
      <h2>{detail?.name ?? selected.name}</h2>
      <p>{detail?.longDescription ?? selected.shortDescription}</p>
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
  const progressPercent = progress?.totalMeters
    ? Math.round((progress.traveledMeters / progress.totalMeters) * 100)
    : 0;

  return (
    <section
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
      <button
        className={`simulation-pick${isPicking ? ' active' : ''}`}
        onClick={onPick}
      >
        {isPicking ? t.clickMap : position ? t.repositionWalker : t.placeWalker}
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
            onClick={onReplay}
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
    </section>
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
