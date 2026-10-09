import type { Map as MapLibreMap } from 'maplibre-gl';

/** One picture map laid over the real map (see `public/maps/index.json`). */
export interface MapPicture {
  id: string;
  url: string;
  georef: string;
  /** Third-party artwork kept out of git: only offered when the file exists. */
  optional?: boolean;
  /** `fitted`: matched to the OSM footpaths with a measured error; else experimental. */
  confidence?: 'fitted' | 'experimental';
}

export interface AddedPicture {
  id: string;
  confidence: 'fitted' | 'experimental';
}

export const PICTURE_LAYER_PREFIX = 'damsen-picture-';
const BEFORE_LAYER = 'damsen-osm-walkways-outline';

type Corners = [
  [number, number],
  [number, number],
  [number, number],
  [number, number],
];

export function pictureLayerId(id: string): string {
  return `${PICTURE_LAYER_PREFIX}${id}`;
}

async function available(picture: MapPicture): Promise<boolean> {
  if (!picture.optional) return true;
  try {
    return (await fetch(picture.url, { method: 'HEAD' })).ok;
  } catch {
    return false;
  }
}

/**
 * Adds every available picture as a hidden raster layer under the OSM walkways,
 * so real routes stay drawn on top and any misalignment is visible. Returns the
 * pictures that were added (first = default). Failures only drop that picture; the old map keeps
 * working. Corners come from `scripts/georeference-illustrated-map/`.
 */
export async function addMapPictures(
  map: MapLibreMap,
): Promise<AddedPicture[]> {
  const added: AddedPicture[] = [];
  try {
    const manifest = (await (await fetch('/maps/index.json')).json()) as {
      pictures: MapPicture[];
    };
    for (const picture of manifest.pictures) {
      try {
        if (!(await available(picture))) continue;
        const georef = (await (await fetch(picture.georef)).json()) as {
          corners: Corners;
        };
        if (!map.getStyle()) return added;
        map.addSource(pictureLayerId(picture.id), {
          type: 'image',
          url: picture.url,
          coordinates: georef.corners,
        });
        map.addLayer(
          {
            id: pictureLayerId(picture.id),
            type: 'raster',
            source: pictureLayerId(picture.id),
            layout: { visibility: 'none' },
            paint: { 'raster-opacity': 1, 'raster-fade-duration': 0 },
          },
          BEFORE_LAYER,
        );
        added.push({
          id: picture.id,
          confidence: picture.confidence ?? 'experimental',
        });
      } catch {
        // Skip this picture only.
      }
    }
  } catch {
    // No manifest: only the old map.
  }
  return added;
}
