# Synthetic Dam Sen vertical-slice fixture

This directory contains a **synthetic demo dataset** for development and tests. Coordinates are placed in the general Dam Sen area only to exercise spatial code. Names, POI descriptions, entrances, paths, accessibility attributes, and operating data are invented; they are not a survey of the park and must not be used for real navigation.

## Files

- `metadata.json`: provenance, license, coordinate reference system, and dataset bounds.
- `pois.geojson`: five fictional POIs with Vietnamese and English fixture content.
- `entrances.geojson`: one routable entrance for each POI.
- `walkway_nodes.geojson`: authoritative fixture vertices `N1`–`N7`.
- `walkway_edges.geojson`: eight connected, bidirectional mini-graph edges.
- `validate.py`: dependency-free structural, WGS84, reference, and topology checks.

GeoJSON uses RFC 7946 coordinate order `[longitude, latitude]` and WGS84 (`EPSG:4326`). IDs and values mirror `docs/product/SAMPLE_DATA_SPEC.md`, `002_seed_synthetic_pois.up.sql`, and `004_walkway_graph.up.sql`. Edge `length_m`, `cost`, and `reverse_cost` are metre-based; `-1` reverse cost would prohibit reverse traversal. `N3-N6` is stairs, while the remaining edges are step-free.

## Validation

From the repository root:

```sh
python3 data/geojson/validate.py
```

The validator fails non-zero and prints focused errors when an authoritative fixture ID/value or reference is invalid, a coordinate falls outside the declared bounds, an edge endpoint does not match its source/target node, an entrance is more than 15 m from its declared node, or default/step-free/rerouting topology is broken.

## Production replacement checklist

- [ ] Obtain permission and record the source/license for the real park map.
- [ ] Survey or digitize walkways and POI entrances; never route to a POI centroid.
- [ ] Confirm one-way restrictions, closures, stairs, ramps, and wheelchair access.
- [ ] Validate geometries/topology, import into the spatial database, and field-test routes.
- [ ] Replace the synthetic provenance and remove the `not_for_real_navigation` restriction.
