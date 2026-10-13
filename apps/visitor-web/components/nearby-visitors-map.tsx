'use client';

import { RealtimeInvalidationGate } from '@damsen/api-client';
import type {
  AuthResponse,
  RealtimeEvent,
  VisitorPresencePoint,
} from '@damsen/shared-types';
import type {
  GeoJSONSource,
  Map as MapLibreMap,
  MapGeoJSONFeature,
  MapMouseEvent,
} from 'maplibre-gl';
import type { RefObject } from 'react';
import { useEffect, useState } from 'react';

import { visitorApi } from '@/lib/api';
import { nearbyPresenceFeatureCollection } from '@/lib/nearby-presence';
import { acquireRealtime } from '@/lib/realtime';

const SOURCE_ID = 'nearby-visitors';
const CLUSTER_LAYER = 'nearby-visitor-clusters';
const CLUSTER_COUNT_LAYER = 'nearby-visitor-cluster-count';
const PEOPLE_LAYER = 'nearby-visitor-people';
const RECONCILE_INTERVAL_MS = 15_000;
const DISCONNECTED_POLL_INTERVAL_MS = 5_000;

type LayerClickEvent = MapMouseEvent & { features?: MapGeoJSONFeature[] };

function pointCoordinates(feature?: MapGeoJSONFeature) {
  if (feature?.geometry.type !== 'Point') return undefined;
  const [longitude, latitude] = feature.geometry.coordinates;
  if (typeof longitude !== 'number' || typeof latitude !== 'number') {
    return undefined;
  }
  return [longitude, latitude] as [number, number];
}

export function NearbyVisitorsMap({
  session,
  mapRef,
  mapReady,
  ownPresenceId,
}: {
  session: AuthResponse | null;
  mapRef: RefObject<MapLibreMap | null>;
  mapReady: boolean;
  ownPresenceId: string | null;
}) {
  const [count, setCount] = useState(0);
  const [realtimeRevision, setRealtimeRevision] = useState(0);

  useEffect(() => {
    const map = mapRef.current;
    if (!session || !mapReady || !map) {
      setCount(0);
      return;
    }

    const points = new Map<string, VisitorPresencePoint>();
    const gate = new RealtimeInvalidationGate();
    let animationFrame: number | undefined;
    let connected = false;
    let cancelled = false;
    let hasPendingRealtimeDelta = false;

    if (!map.getSource(SOURCE_ID)) {
      map.addSource(SOURCE_ID, {
        type: 'geojson',
        data: nearbyPresenceFeatureCollection([], ownPresenceId),
        cluster: true,
        clusterRadius: 34,
        clusterMaxZoom: 15,
      });
      map.addLayer({
        id: CLUSTER_LAYER,
        type: 'circle',
        source: SOURCE_ID,
        filter: ['has', 'point_count'],
        paint: {
          'circle-color': '#266c54',
          'circle-radius': [
            'step',
            ['get', 'point_count'],
            15,
            25,
            20,
            100,
            26,
          ],
          'circle-stroke-color': '#ffffff',
          'circle-stroke-width': 3,
        },
      });
      map.addLayer({
        id: CLUSTER_COUNT_LAYER,
        type: 'symbol',
        source: SOURCE_ID,
        filter: ['has', 'point_count'],
        layout: {
          'text-field': ['get', 'point_count_abbreviated'],
          'text-size': 11,
        },
        paint: { 'text-color': '#ffffff' },
      });
      map.addLayer({
        id: PEOPLE_LAYER,
        type: 'circle',
        source: SOURCE_ID,
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
          'circle-radius': 9,
          'circle-stroke-color': [
            'case',
            ['==', ['get', 'locationMode'], 'simulated'],
            '#f1b544',
            '#ffffff',
          ],
          'circle-stroke-width': 3,
        },
      });
    }

    const render = () => {
      animationFrame = undefined;
      const source = map.getSource(SOURCE_ID) as GeoJSONSource | undefined;
      source?.setData(
        nearbyPresenceFeatureCollection(points.values(), ownPresenceId),
      );
      setCount(
        [...points.values()].filter(
          (point) => point.presenceId !== ownPresenceId,
        ).length,
      );
      if (hasPendingRealtimeDelta) {
        hasPendingRealtimeDelta = false;
        setRealtimeRevision((value) => value + 1);
      }
    };
    const scheduleRender = () => {
      animationFrame ??= window.requestAnimationFrame(render);
    };
    const refreshSnapshot = async () => {
      const snapshot = await visitorApi.getNearbyPresence(session.accessToken);
      if (cancelled) return;
      points.clear();
      for (const point of snapshot.items) points.set(point.presenceId, point);
      scheduleRender();
    };
    const onDelta = (
      event: RealtimeEvent<
        VisitorPresencePoint | { presenceId: string; removed: true }
      >,
    ) => {
      if (!gate.accept(event) || !event.payload.presenceId) return;
      if ('removed' in event.payload) points.delete(event.payload.presenceId);
      else points.set(event.payload.presenceId, event.payload);
      hasPendingRealtimeDelta = true;
      scheduleRender();
    };
    const onClusterClick = async (event: LayerClickEvent) => {
      const feature = event.features?.[0];
      const clusterId = feature?.properties?.cluster_id;
      const coordinates = pointCoordinates(feature);
      if (typeof clusterId !== 'number' || !coordinates) return;
      const source = map.getSource(SOURCE_ID) as GeoJSONSource;
      map.easeTo({
        center: coordinates,
        zoom: await source.getClusterExpansionZoom(clusterId),
      });
    };
    const onPersonClick = async (event: LayerClickEvent) => {
      const feature = event.features?.[0];
      const coordinates = pointCoordinates(feature);
      const pseudonym = feature?.properties?.pseudonym;
      const locationMode = feature?.properties?.locationMode;
      if (!coordinates || typeof pseudonym !== 'string') return;
      const maplibregl = await import('maplibre-gl');
      new maplibregl.Popup({ closeButton: false, offset: 13 })
        .setLngLat(coordinates)
        .setText(
          `${pseudonym} · ${locationMode === 'simulated' ? 'Mô phỏng' : 'Vị trí ẩn danh'}`,
        )
        .addTo(map);
    };
    const pointer = () => {
      map.getCanvas().style.cursor = 'pointer';
    };
    const clearPointer = () => {
      map.getCanvas().style.cursor = '';
    };

    map.on('click', CLUSTER_LAYER, onClusterClick);
    map.on('click', PEOPLE_LAYER, onPersonClick);
    map.on('mouseenter', CLUSTER_LAYER, pointer);
    map.on('mouseleave', CLUSTER_LAYER, clearPointer);
    map.on('mouseenter', PEOPLE_LAYER, pointer);
    map.on('mouseleave', PEOPLE_LAYER, clearPointer);

    const realtime = acquireRealtime(session.accessToken);
    const { socket } = realtime;
    socket.on('connect', () => {
      connected = true;
      gate.reset();
      void refreshSnapshot().catch(() => undefined);
    });
    socket.on('disconnect', () => {
      connected = false;
    });
    socket.on('visitor.presence.delta.v1', onDelta);
    void refreshSnapshot().catch(() => undefined);

    const reconcileTimer = window.setInterval(
      () => void refreshSnapshot().catch(() => undefined),
      RECONCILE_INTERVAL_MS,
    );
    const disconnectedTimer = window.setInterval(() => {
      if (!connected) void refreshSnapshot().catch(() => undefined);
    }, DISCONNECTED_POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      realtime.release();
      window.clearInterval(reconcileTimer);
      window.clearInterval(disconnectedTimer);
      if (animationFrame !== undefined) {
        window.cancelAnimationFrame(animationFrame);
      }
      try {
        map.off('click', CLUSTER_LAYER, onClusterClick);
        map.off('click', PEOPLE_LAYER, onPersonClick);
        map.off('mouseenter', CLUSTER_LAYER, pointer);
        map.off('mouseleave', CLUSTER_LAYER, clearPointer);
        map.off('mouseenter', PEOPLE_LAYER, pointer);
        map.off('mouseleave', PEOPLE_LAYER, clearPointer);
        for (const layer of [
          PEOPLE_LAYER,
          CLUSTER_COUNT_LAYER,
          CLUSTER_LAYER,
        ]) {
          if (map.getLayer(layer)) map.removeLayer(layer);
        }
        if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
      } catch {
        // The parent map may already be destroyed during page teardown.
      }
    };
  }, [mapReady, mapRef, ownPresenceId, session]);

  if (!session) return null;
  return (
    <div
      className="nearby-visitors-status"
      aria-live="polite"
      data-realtime-revision={realtimeRevision}
    >
      <strong>{count}</strong> khách khác trên bản đồ
    </div>
  );
}
