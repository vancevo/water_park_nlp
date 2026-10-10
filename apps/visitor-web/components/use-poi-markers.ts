'use client';

import type { PoiSummary } from '@damsen/shared-types';
import type { Map as MapLibreMap, Marker } from 'maplibre-gl';
import { useEffect, useRef, type RefObject } from 'react';
import { amenityIconUrl, amenityKind } from '@/lib/amenities';
import {
  MIN_TOUCH_PX,
  layoutMarkers,
  pinSizeForZoom,
  type LayoutPoint,
} from '@/lib/marker-layout';
import { formatPoiNumber, isNewPlace } from '@/lib/poi-number';
import { poiPinColor } from '@/lib/poi-pin-colors';

interface PoolEntry {
  poi: PoiSummary;
  marker: Marker;
  /** The element MapLibre positions (wraps the pin, or is the icon itself). */
  host: HTMLElement;
  /** The clickable pin / icon. */
  button: HTMLElement;
  isIcon: boolean;
}

interface ClusterEntry {
  marker: Marker;
  element: HTMLButtonElement;
  ids: string[];
}

/** Fallback while the whole-park zoom is not known yet. */
const DEFAULT_REFERENCE_ZOOM = 15.8;

/**
 * Draws the places on the map: a pin per place (its size follows the zoom), and a cluster badge
 * where touch areas would overlap. Markers are created once per place and only shown, hidden
 * and re-sized when the camera moves; the clustering itself is the pure lib/marker-layout.ts.
 * A pin's tip stays on the place's real coordinates; nothing is moved to avoid overlap.
 */
export function usePoiMarkers({
  mapRef,
  containerRef,
  mapReady,
  pois,
  selectedId,
  priorityIds,
  referenceZoom,
  onOpen,
  onCluster,
  clusterLabel,
}: {
  mapRef: RefObject<MapLibreMap | null>;
  containerRef: RefObject<HTMLDivElement | null>;
  mapReady: boolean;
  pois: PoiSummary[];
  selectedId: string | null;
  /** Places always drawn on their own: selected, route destination, being narrated. */
  priorityIds: readonly string[];
  referenceZoom: number | null;
  onOpen(poi: PoiSummary): void;
  onCluster(ids: string[], screen: { x: number; y: number }): void;
  clusterLabel(count: number): string;
}) {
  const pool = useRef(new Map<string, PoolEntry>());
  const clusters = useRef(new Map<string, ClusterEntry>());
  const previous = useRef<ReadonlyMap<string, string>>(new Map());
  const relayoutRef = useRef<() => void>(() => {});
  const frame = useRef<number | null>(null);
  const live = useRef({
    onOpen,
    onCluster,
    clusterLabel,
    priorityIds,
    referenceZoom,
    selectedId,
  });
  live.current = {
    onOpen,
    onCluster,
    clusterLabel,
    priorityIds,
    referenceZoom,
    selectedId,
  };

  // One marker per place; stale ones go.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    let cancelled = false;
    void import('maplibre-gl').then((maplibregl) => {
      if (cancelled) return;
      const ids = new Set(pois.map((poi) => poi.id));
      for (const [id, entry] of pool.current) {
        if (!ids.has(id)) {
          entry.marker.remove();
          pool.current.delete(id);
        }
      }
      for (const poi of pois) {
        const existing = pool.current.get(poi.id);
        if (existing) {
          existing.poi = poi;
          existing.button.ariaLabel = poi.name;
          existing.button.title = poi.name;
          continue;
        }
        const kind = amenityKind(poi.slug);
        const button = document.createElement('button');
        button.type = 'button';
        button.ariaLabel = poi.name;
        button.title = poi.name;
        let host: HTMLElement;
        if (kind) {
          // Service point: the icon of the official map, small but with a white ring.
          button.className = 'amenity-pin';
          button.innerHTML = `<img src="${amenityIconUrl(kind)}" alt="" draggable="false" />`;
          host = button;
        } else {
          const color = poiPinColor(poi.slug);
          button.className = `map-pin${color ? ` pin-${color}` : ''}${isNewPlace(poi.slug) ? ' new' : ''}`;
          button.innerHTML = `<span>${formatPoiNumber(poi.slug)}</span>`;
          // MapLibre overwrites its element's transform, so the pin lives inside a wrapper;
          // anchored bottom-left, the pin's tip sits exactly on the coordinates.
          host = document.createElement('div');
          host.className = 'pin-anchor';
          host.appendChild(button);
        }
        button.addEventListener('click', () => {
          const entry = pool.current.get(poi.id);
          if (entry) live.current.onOpen(entry.poi);
        });
        const marker = new maplibregl.Marker({
          element: host,
          anchor: kind ? 'center' : 'bottom-left',
        })
          .setLngLat([poi.location.longitude, poi.location.latitude])
          .addTo(map);
        pool.current.set(poi.id, {
          poi,
          marker,
          host,
          button,
          isIcon: Boolean(kind),
        });
      }
      relayoutRef.current();
    });
    return () => {
      cancelled = true;
    };
  }, [mapRef, mapReady, pois]);

  // Everything below runs on camera moves, never per React render.
  useEffect(() => {
    const map = mapRef.current;
    const container = containerRef.current;
    if (!map || !mapReady || !container) return;

    const relayout = () => {
      const zoom = map.getZoom();
      const size = pinSizeForZoom(
        zoom,
        live.current.referenceZoom ?? DEFAULT_REFERENCE_ZOOM,
      );
      const coarse = window.matchMedia('(pointer: coarse)').matches;
      const hitPx = Math.max(size, coarse ? MIN_TOUCH_PX : 0);
      const clusterPx = Math.max(
        Math.round(size * 1.15),
        coarse ? MIN_TOUCH_PX : 26,
      );
      container.style.setProperty('--pin-size', `${size}px`);
      container.style.setProperty('--hit-size', `${hitPx}px`);
      container.style.setProperty('--cluster-size', `${clusterPx}px`);

      const priority = new Set(live.current.priorityIds);
      const points: LayoutPoint[] = [];
      for (const [id, entry] of pool.current) {
        const at = map.project([
          entry.poi.location.longitude,
          entry.poi.location.latitude,
        ]);
        points.push({
          id,
          cx: at.x,
          // A pin's touch area is its body, above the tip; an icon is centred on the spot.
          cy: entry.isIcon ? at.y : at.y - size * 0.7,
          priority: priority.has(id),
        });
      }
      const result = layoutMarkers(points, {
        hitPx,
        clusterPx,
        viewport: {
          width: container.clientWidth,
          height: container.clientHeight,
        },
        previous: previous.current,
      });
      previous.current = result.groups;
      const drawn = new Set(result.singles);
      for (const [id, entry] of pool.current) {
        entry.host.style.display = drawn.has(id) ? '' : 'none';
        entry.button.classList.toggle(
          'selected',
          id === live.current.selectedId,
        );
        entry.button.classList.toggle('priority', priority.has(id));
      }

      const seen = new Set<string>();
      for (const cluster of result.clusters) {
        seen.add(cluster.key);
        let entry = clusters.current.get(cluster.key);
        if (!entry) {
          const element = document.createElement('button');
          element.type = 'button';
          const created: ClusterEntry = {
            marker: null as unknown as Marker,
            element,
            ids: [],
          };
          element.addEventListener('click', (event) => {
            event.stopPropagation();
            const rect = container.getBoundingClientRect();
            live.current.onCluster(created.ids, {
              x: event.clientX - rect.left,
              y: event.clientY - rect.top,
            });
          });
          entry = created;
          clusters.current.set(cluster.key, created);
          void import('maplibre-gl').then((maplibregl) => {
            created.marker = new maplibregl.Marker({ element }).setLngLat(
              map.unproject([cluster.cx, cluster.cy]),
            );
            if (clusters.current.get(cluster.key) === created) {
              created.marker.addTo(map);
            }
          });
        }
        entry.ids = cluster.ids;
        // classList, not className: MapLibre adds its own class to the marker element.
        entry.element.classList.add('cluster-pin');
        entry.element.classList.toggle('attached', cluster.attachedTo !== null);
        entry.element.ariaLabel = live.current.clusterLabel(cluster.ids.length);
        entry.element.innerHTML = `<span>${cluster.attachedTo ? '+' : ''}${cluster.ids.length}</span>`;
        entry.marker?.setLngLat(map.unproject([cluster.cx, cluster.cy]));
      }
      for (const [key, entry] of clusters.current) {
        if (!seen.has(key)) {
          entry.marker?.remove();
          clusters.current.delete(key);
        }
      }
    };
    relayoutRef.current = relayout;
    const schedule = () => {
      if (frame.current !== null) return;
      frame.current = window.requestAnimationFrame(() => {
        frame.current = null;
        relayout();
      });
    };
    map.on('move', schedule);
    map.on('zoom', schedule);
    map.on('resize', schedule);
    relayout();
    return () => {
      map.off('move', schedule);
      map.off('zoom', schedule);
      map.off('resize', schedule);
      if (frame.current !== null) window.cancelAnimationFrame(frame.current);
      frame.current = null;
    };
  }, [mapRef, containerRef, mapReady]);

  // The state it depends on changed: redraw now.
  useEffect(() => {
    relayoutRef.current();
  }, [selectedId, priorityIds, referenceZoom, pois]);

  // Nothing is left on the map when the page goes.
  useEffect(() => {
    const markers = pool.current;
    const badges = clusters.current;
    return () => {
      for (const entry of markers.values()) entry.marker.remove();
      for (const entry of badges.values()) entry.marker?.remove();
      markers.clear();
      badges.clear();
    };
  }, []);
}
