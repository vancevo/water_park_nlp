'use client';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { Map as MapLibreMap, Marker } from 'maplibre-gl';
import { useEffect, useRef } from 'react';

interface Point {
  latitude: number;
  longitude: number;
}

const MAP_IMAGE = '/maps/damsen-map.jpg';
const MAP_GEOREF = '/maps/damsen-map.georef.json';
const FALLBACK_CENTER: [number, number] = [106.63853, 10.76433];

function markerElement(kind: 'poi' | 'entrance', primary = false) {
  const element = document.createElement('div');
  element.className = `map-pin ${kind}${primary ? ' primary' : ''}`;
  element.title = kind === 'poi' ? 'Vị trí POI' : 'Cổng vào dẫn đường';
  return element;
}

/**
 * Small map to place a POI: the illustrated park map under the OSM footpaths,
 * the POI marker (green) and its entrances (gold). Click the map to move the POI
 * marker (when `onPick` is given); it also follows the latitude/longitude fields.
 */
export function PoiLocationMap({
  poi,
  entrances,
  onPick,
}: {
  poi: Point;
  entrances: (Point & { isPrimary: boolean })[];
  onPick?: (point: Point) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const markersRef = useRef<Marker[]>([]);
  const onPickRef = useRef(onPick);
  const latestRef = useRef({ poi, entrances });
  onPickRef.current = onPick;
  latestRef.current = { poi, entrances };

  const draw = async () => {
    const map = mapRef.current;
    if (!map) return;
    const maplibregl = await import('maplibre-gl');
    markersRef.current.forEach((marker) => marker.remove());
    const { poi: place, entrances: doors } = latestRef.current;
    const next: Marker[] = [];
    const valid = (p: Point) =>
      Number.isFinite(p.latitude) &&
      Number.isFinite(p.longitude) &&
      (p.latitude !== 0 || p.longitude !== 0);
    for (const door of doors) {
      if (!valid(door)) continue;
      next.push(
        new maplibregl.Marker({
          element: markerElement('entrance', door.isPrimary),
        })
          .setLngLat([door.longitude, door.latitude])
          .addTo(map),
      );
    }
    if (valid(place)) {
      next.push(
        new maplibregl.Marker({ element: markerElement('poi') })
          .setLngLat([place.longitude, place.latitude])
          .addTo(map),
      );
    }
    markersRef.current = next;
  };

  useEffect(() => {
    let cancelled = false;
    void import('maplibre-gl').then(async (maplibregl) => {
      const container = containerRef.current;
      if (cancelled || !container || mapRef.current) return;
      maplibregl.setWorkerUrl('/maplibre/maplibre-gl-worker.mjs');
      const start = latestRef.current.poi;
      const map = new maplibregl.Map({
        container,
        style: {
          version: 8,
          sources: {},
          layers: [
            {
              id: 'ground',
              type: 'background',
              paint: { 'background-color': '#e4ece5' },
            },
          ],
        },
        center:
          start.latitude || start.longitude
            ? [start.longitude, start.latitude]
            : FALLBACK_CENTER,
        zoom: 17,
        attributionControl: false,
      });
      map.addControl(new maplibregl.NavigationControl(), 'bottom-right');
      map.addControl(
        new maplibregl.AttributionControl({
          compact: true,
          customAttribution: '© OpenStreetMap contributors',
        }),
        'bottom-left',
      );
      map.on('click', (event) =>
        onPickRef.current?.({
          latitude: Number(event.lngLat.lat.toFixed(7)),
          longitude: Number(event.lngLat.lng.toFixed(7)),
        }),
      );
      map.once('load', async () => {
        try {
          const georef = (await (await fetch(MAP_GEOREF)).json()) as {
            corners: [
              [number, number],
              [number, number],
              [number, number],
              [number, number],
            ];
            bearingDegrees?: number;
          };
          // Turn the map so the official picture is upright (gate 1 at the bottom).
          map.setBearing(georef.bearingDegrees ?? 0);
          map.addSource('park-picture', {
            type: 'image',
            url: MAP_IMAGE,
            coordinates: georef.corners,
          });
          map.addLayer({
            id: 'park-picture',
            type: 'raster',
            source: 'park-picture',
            paint: { 'raster-fade-duration': 0 },
          });
        } catch {
          // Without the picture the footpaths alone still show.
        }
        map.addSource('walkways', {
          type: 'geojson',
          data: '/data/damsen-walkways.geojson',
        });
        map.addLayer({
          id: 'walkways-outline',
          type: 'line',
          source: 'walkways',
          paint: {
            'line-color': '#1f513f',
            'line-width': 5,
            'line-opacity': 0.7,
          },
        });
        map.addLayer({
          id: 'walkways',
          type: 'line',
          source: 'walkways',
          paint: { 'line-color': '#f7f0db', 'line-width': 2.5 },
        });
        void draw();
      });
      mapRef.current = map;
    });
    return () => {
      cancelled = true;
      markersRef.current.forEach((marker) => marker.remove());
      mapRef.current?.remove();
      mapRef.current = null;
    };
  }, []);

  useEffect(() => {
    void draw();
    const map = mapRef.current;
    if (map && (poi.latitude || poi.longitude)) {
      map.easeTo({ center: [poi.longitude, poi.latitude], duration: 400 });
    }
  }, [poi.latitude, poi.longitude, JSON.stringify(entrances)]);

  return (
    <div
      ref={containerRef}
      className="poi-map"
      role="img"
      aria-label="Bản đồ đặt vị trí POI"
    />
  );
}
