'use client';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { Map as MapLibreMap, Marker } from 'maplibre-gl';
import { useEffect, useRef } from 'react';

export interface FieldMarker {
  kind: 'poi' | 'entrance' | 'measured' | 'me';
  latitude: number;
  longitude: number;
  title?: string;
}

const MAP_IMAGE = '/maps/damsen-map.jpg';
const MAP_GEOREF = '/maps/damsen-map.georef.json';
const FALLBACK_CENTER: [number, number] = [106.63853, 10.76433];

/** A circle of `meters` radius around a point, as a GeoJSON polygon. */
export function circlePolygon(
  latitude: number,
  longitude: number,
  meters: number,
  steps = 48,
): GeoJSON.Feature<GeoJSON.Polygon> {
  const coordinates: [number, number][] = [];
  const dLat = meters / 110_574;
  const dLon = meters / (111_320 * Math.cos((latitude * Math.PI) / 180));
  for (let i = 0; i <= steps; i += 1) {
    const angle = (i / steps) * 2 * Math.PI;
    coordinates.push([
      longitude + dLon * Math.cos(angle),
      latitude + dLat * Math.sin(angle),
    ]);
  }
  return {
    type: 'Feature',
    properties: {},
    geometry: { type: 'Polygon', coordinates: [coordinates] },
  };
}

const EMPTY: GeoJSON.FeatureCollection = {
  type: 'FeatureCollection',
  features: [],
};

/**
 * Map for the field screens: the illustrated park map under the OSM footpaths, markers
 * (POI green, entrance gold, measured point red, "me" blue) and an optional accuracy
 * circle. It frames all markers once and whenever `fitKey` changes.
 */
export function FieldMap({
  markers,
  circle,
  fitKey,
  className = 'field-map',
}: {
  markers: FieldMarker[];
  circle?: { latitude: number; longitude: number; meters: number };
  fitKey: string;
  className?: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MapLibreMap | null>(null);
  const readyRef = useRef(false);
  const markersRef = useRef<Marker[]>([]);
  const latest = useRef({ markers, circle, fitKey });
  latest.current = { markers, circle, fitKey };
  const fittedFor = useRef('');

  const draw = async () => {
    const map = mapRef.current;
    if (!map || !readyRef.current) return;
    const maplibregl = await import('maplibre-gl');
    markersRef.current.forEach((marker) => marker.remove());
    const { markers: items, circle: ring, fitKey: key } = latest.current;
    markersRef.current = items.map((item) => {
      const element = document.createElement('div');
      element.className = `map-pin ${item.kind === 'me' ? 'me' : item.kind}`;
      if (item.title) element.title = item.title;
      return new maplibregl.Marker({ element })
        .setLngLat([item.longitude, item.latitude])
        .addTo(map);
    });
    const source = map.getSource('accuracy') as
      | { setData(data: GeoJSON.GeoJSON): void }
      | undefined;
    source?.setData(
      ring ? circlePolygon(ring.latitude, ring.longitude, ring.meters) : EMPTY,
    );
    if (items.length > 0 && fittedFor.current !== key) {
      fittedFor.current = key;
      const bounds = new maplibregl.LngLatBounds();
      items.forEach((item) => bounds.extend([item.longitude, item.latitude]));
      if (items.length === 1) {
        map.easeTo({ center: bounds.getCenter(), zoom: 18.5, duration: 300 });
      } else {
        map.fitBounds(bounds, {
          padding: 60,
          maxZoom: 19,
          duration: 300,
          bearing: map.getBearing(),
        });
      }
    }
  };

  useEffect(() => {
    let cancelled = false;
    void import('maplibre-gl').then((maplibregl) => {
      const container = containerRef.current;
      if (cancelled || !container || mapRef.current) return;
      maplibregl.setWorkerUrl('/maplibre/maplibre-gl-worker.mjs');
      const first = latest.current.markers[0];
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
        center: first ? [first.longitude, first.latitude] : FALLBACK_CENTER,
        zoom: 17.5,
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
          // Footpaths alone still show.
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
        map.addSource('accuracy', { type: 'geojson', data: EMPTY });
        map.addLayer({
          id: 'accuracy-fill',
          type: 'fill',
          source: 'accuracy',
          paint: { 'fill-color': '#2f7df6', 'fill-opacity': 0.18 },
        });
        map.addLayer({
          id: 'accuracy-line',
          type: 'line',
          source: 'accuracy',
          paint: { 'line-color': '#2f7df6', 'line-width': 1.5 },
        });
        readyRef.current = true;
        void draw();
      });
      mapRef.current = map;
    });
    return () => {
      cancelled = true;
      markersRef.current.forEach((marker) => marker.remove());
      mapRef.current?.remove();
      mapRef.current = null;
      readyRef.current = false;
    };
  }, []);

  const signature = JSON.stringify([markers, circle, fitKey]);
  useEffect(() => {
    void draw();
  }, [signature]);

  return (
    <div
      ref={containerRef}
      className={className}
      role="img"
      aria-label="Bản đồ hiện trường"
    />
  );
}
