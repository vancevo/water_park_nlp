import type { Map as MapLibreMap } from 'maplibre-gl';

/**
 * The official park map (gate 1 at the bottom), laid over the real map as a raster layer under the
 * walkways, so routes stay drawn on top. Its corners and the `bearingDegrees` that turns the map
 * so the picture is upright come from `data/walkways-new/build_graph.py` (footpaths traced on the
 * picture and fitted to the earlier illustrated picture, itself fitted to the OSM footpaths;
 * ~3-8 m, not verified on site).
 */
export const ILLUSTRATED_MAP_URL = '/maps/damsen-map.jpg';
export const ILLUSTRATED_MAP_GEOREF = '/maps/damsen-map.georef.json';
export const ILLUSTRATED_LAYER = 'damsen-illustrated-map';
const BEFORE_LAYER = 'damsen-osm-walkways-outline';

type Corners = [
  [number, number],
  [number, number],
  [number, number],
  [number, number],
];

/**
 * Adds the picture as a hidden layer; resolves the bearing that shows it upright,
 * or null (old map only) on failure.
 */
export async function addIllustratedMap(
  map: MapLibreMap,
): Promise<number | null> {
  try {
    const georef = (await (await fetch(ILLUSTRATED_MAP_GEOREF)).json()) as {
      corners: Corners;
      bearingDegrees?: number;
    };
    if (!map.getStyle()) return null;
    map.addSource(ILLUSTRATED_LAYER, {
      type: 'image',
      url: ILLUSTRATED_MAP_URL,
      coordinates: georef.corners,
    });
    map.addLayer(
      {
        id: ILLUSTRATED_LAYER,
        type: 'raster',
        source: ILLUSTRATED_LAYER,
        layout: { visibility: 'none' },
        paint: { 'raster-opacity': 1, 'raster-fade-duration': 0 },
      },
      BEFORE_LAYER,
    );
    return georef.bearingDegrees ?? 0;
  } catch {
    return null;
  }
}
