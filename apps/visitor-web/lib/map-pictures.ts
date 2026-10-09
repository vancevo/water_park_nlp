import type { Map as MapLibreMap } from 'maplibre-gl';

/**
 * The illustrated park map, laid over the real map as a raster layer under the
 * OSM walkways, so real routes stay drawn on top. Its corners come from
 * `scripts/georeference-illustrated-map/fit_paths.py` (painted paths fitted to
 * the OSM footpaths, ~0.8 m mean distance; not verified on site).
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

/** Adds the picture as a hidden layer; resolves false (old map only) on failure. */
export async function addIllustratedMap(map: MapLibreMap): Promise<boolean> {
  try {
    const georef = (await (await fetch(ILLUSTRATED_MAP_GEOREF)).json()) as {
      corners: Corners;
    };
    if (!map.getStyle()) return false;
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
    return true;
  } catch {
    return false;
  }
}
