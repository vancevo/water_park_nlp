'use client';

import type { AdminPresencePoint } from '@damsen/shared-types';
import type { GeoJSONSource, Map as MapLibreMap } from 'maplibre-gl';
import { useCallback, useEffect, useRef } from 'react';

const CENTER: [number, number] = [106.63853, 10.76433];

function featureCollection(points: AdminPresencePoint[]) {
  return {
    type: 'FeatureCollection' as const,
    features: points.map((point) => ({
      type: 'Feature' as const,
      id: point.sessionId,
      geometry: {
        type: 'Point' as const,
        coordinates: [point.longitude, point.latitude],
      },
      properties: {
        pseudonym: point.pseudonym,
        avatarVariant: point.avatarVariant,
        hasPaidTicket: point.hasPaidTicket,
        destinationPoiId: point.destinationPoiId ?? '',
        updatedAt: point.updatedAt,
      },
    })),
  };
}

export function LivePresenceMap({ points }: { points: AdminPresencePoint[] }) {
  const container = useRef<HTMLDivElement>(null);
  const map = useRef<MapLibreMap | null>(null);
  const lastFitKey = useRef('');
  const latestPoints = useRef(points);
  latestPoints.current = points;

  const updateSource = useCallback(() => {
    const source = map.current?.getSource('live-presence') as
      | GeoJSONSource
      | undefined;
    source?.setData(featureCollection(latestPoints.current));
    const fitKey = latestPoints.current
      .map((point) => point.sessionId)
      .sort()
      .join(',');
    if (!map.current || !fitKey || fitKey === lastFitKey.current) return;
    lastFitKey.current = fitKey;
    const longitudes = latestPoints.current.map((point) => point.longitude);
    const latitudes = latestPoints.current.map((point) => point.latitude);
    if (latestPoints.current.length === 1) {
      map.current.easeTo({
        center: [longitudes[0]!, latitudes[0]!],
        zoom: 17.5,
        duration: 0,
      });
      return;
    }
    map.current.fitBounds(
      [
        [Math.min(...longitudes), Math.min(...latitudes)],
        [Math.max(...longitudes), Math.max(...latitudes)],
      ],
      { padding: 60, maxZoom: 17.5, duration: 0 },
    );
  }, []);

  useEffect(() => {
    let cancelled = false;
    void import('maplibre-gl').then((maplibregl) => {
      if (cancelled || !container.current || map.current) return;
      maplibregl.setWorkerUrl('/maplibre/maplibre-gl-worker.mjs');
      const next = new maplibregl.Map({
        container: container.current,
        style: {
          version: 8,
          sources: {},
          layers: [
            {
              id: 'ground',
              type: 'background',
              paint: { 'background-color': '#e2ebe5' },
            },
          ],
        },
        center: CENTER,
        zoom: 16.8,
        attributionControl: false,
      });
      next.addControl(new maplibregl.NavigationControl(), 'bottom-right');
      next.once('load', async () => {
        try {
          const georef = (await (
            await fetch('/maps/damsen-map.georef.json')
          ).json()) as {
            corners: [
              [number, number],
              [number, number],
              [number, number],
              [number, number],
            ];
            bearingDegrees?: number;
          };
          next.setBearing(georef.bearingDegrees ?? 0);
          next.addSource('park', {
            type: 'image',
            url: '/maps/damsen-map.jpg',
            coordinates: georef.corners,
          });
          next.addLayer({
            id: 'park',
            type: 'raster',
            source: 'park',
            paint: { 'raster-fade-duration': 0 },
          });
        } catch {
          // Live presence remains usable on the neutral fallback.
        }
        next.addSource('live-presence', {
          type: 'geojson',
          data: featureCollection(latestPoints.current),
          cluster: true,
          clusterRadius: 46,
          clusterMaxZoom: 16,
        });
        next.addLayer({
          id: 'presence-clusters',
          type: 'circle',
          source: 'live-presence',
          filter: ['has', 'point_count'],
          paint: {
            'circle-color': [
              'step',
              ['get', 'point_count'],
              '#49a985',
              25,
              '#efb542',
              100,
              '#dd705d',
            ],
            'circle-radius': [
              'step',
              ['get', 'point_count'],
              16,
              25,
              22,
              100,
              29,
            ],
            'circle-stroke-color': '#ffffff',
            'circle-stroke-width': 3,
          },
        });
        next.addLayer({
          id: 'presence-people',
          type: 'circle',
          source: 'live-presence',
          filter: ['!', ['has', 'point_count']],
          paint: {
            'circle-color': [
              'match',
              ['get', 'avatarVariant'],
              0,
              '#13795b',
              1,
              '#2b78c5',
              2,
              '#d38227',
              3,
              '#a257bb',
              4,
              '#dd705d',
              5,
              '#3c998b',
              6,
              '#7c6fc2',
              '#69756f',
            ],
            'circle-radius': 8,
            'circle-stroke-color': [
              'case',
              ['get', 'hasPaidTicket'],
              '#087252',
              '#df7b18',
            ],
            'circle-stroke-width': 4,
          },
        });
        next.on('click', 'presence-clusters', async (event) => {
          const feature = event.features?.[0];
          const clusterId = feature?.properties?.cluster_id as
            | number
            | undefined;
          if (clusterId === undefined) return;
          const source = next.getSource('live-presence') as GeoJSONSource;
          const zoom = await source.getClusterExpansionZoom(clusterId);
          const coordinates = (
            feature?.geometry as { coordinates?: [number, number] }
          )?.coordinates;
          if (coordinates) next.easeTo({ center: coordinates, zoom });
        });
        next.on('mouseenter', 'presence-clusters', () => {
          next.getCanvas().style.cursor = 'pointer';
        });
        next.on('mouseleave', 'presence-clusters', () => {
          next.getCanvas().style.cursor = '';
        });
        next.on('click', 'presence-people', (event) => {
          const feature = event.features?.[0];
          const coordinates = (
            feature?.geometry as { coordinates?: [number, number] }
          )?.coordinates;
          const pseudonym = feature?.properties?.pseudonym as
            | string
            | undefined;
          if (!coordinates || !pseudonym) return;
          const hasPaidTicket = Boolean(feature?.properties?.hasPaidTicket);
          new maplibregl.Popup({ closeButton: false, offset: 12 })
            .setLngLat(coordinates)
            .setText(
              `${pseudonym} · ${hasPaidTicket ? 'Đã mua vé' : 'Chưa mua vé'}`,
            )
            .addTo(next);
        });
        next.on('mouseenter', 'presence-people', () => {
          next.getCanvas().style.cursor = 'pointer';
        });
        next.on('mouseleave', 'presence-people', () => {
          next.getCanvas().style.cursor = '';
        });
        updateSource();
      });
      map.current = next;
    });
    return () => {
      cancelled = true;
      map.current?.remove();
      map.current = null;
    };
  }, [updateSource]);

  useEffect(updateSource, [points, updateSource]);

  return (
    <div
      className="live-presence-map"
      ref={container}
      aria-label="Bản đồ người dùng đang chia sẻ vị trí"
    />
  );
}
