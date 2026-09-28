# ADR 0003: Routing with PostGIS and pgRouting

- Status: Accepted
- Date: 2026-09-24

## Context

Public road datasets may omit internal park paths. The MVP needs deterministic pedestrian routing, temporary edge closure and entrance targeting over a relatively small custom graph.

## Decision

- Store the authoritative walkway graph in PostgreSQL/PostGIS and route with pgRouting.
- Import WGS84 GeoJSON (`EPSG:4326`), validate it, and derive routable topology with stable node/edge IDs.
- Store length/time cost, reverse cost, access profile, accessibility attributes, status and source/provenance on edges.
- Use A* when valid coordinates/heuristic are available; retain Dijkstra as deterministic fallback/test oracle.
- Snap the visitor start and the selected active POI entrance to a nearby eligible node/edge within a bounded threshold. Never route to a POI centroid by default.
- Recalculate routes through the API; route progress and multi-sample off-route detection occur on the device.
- Exclude closed or profile-incompatible edges at query time.

The graph pipeline must use the mini graph in [`SAMPLE_DATA_SPEC.md`](../product/SAMPLE_DATA_SPEC.md) as its deterministic contract.

## Consequences

This reuses the primary spatial database, keeps local setup small and allows transactional route closures. It is appropriate for a park graph but does not supply high-level navigation instructions/map matching out of the box; those remain application logic. GraphHopper can be reconsidered if graph size, profiles or turn restrictions outgrow this design.

pgRouting is open-source software under its published license; T01/T02 must inventory the exact packaged versions and licenses. Data licenses remain separate.

## Alternatives rejected

- GraphHopper now: capable, but adds a JVM service and separate import/deployment lifecycle before scale requires it.
- External directions API: cannot be assumed to know private/internal walkways or closures.
- Custom A* as the production engine: duplicates mature graph/database capability; a small reference implementation is acceptable only in tests/education material.

