# ADR 0002: Map rendering, tiles and data rights

- Status: Accepted with production legal gate
- Date: 2026-09-24

## Context

The app needs an interactive basemap and custom POI/walkway layers without coupling the product to a proprietary rendering SDK. Rendering software, tile service and map data have separate licenses/terms.

## Decision

- Render with MapLibre GL (React Native binding selected/pinned in T01).
- Configure the tile provider through environment variables; never commit an API key. The local research environment currently uses Geoapify raster tiles, while staging/production may use an approved Geoapify, MapTiler or self-hosted provider without changing feature code.
- Keep a provider-neutral style URL/config boundary so production can use an approved MapTiler plan or self-hosted tiles without changing feature code.
- Display provider/data attribution on every map view; it may not be obscured or removed.
- Do not scrape/download tiles, prefetch areas or provide offline basemaps unless the chosen provider terms explicitly permit it.
- Store custom POIs, entrances and walkway graph separately from the basemap, with provenance/license metadata.
- Local research may use a dated OpenStreetMap/Overpass snapshot for POI and walkway reference when attribution and ODbL provenance are retained. OSM data is not evidence that a private park path is currently open, safe or accessible.
- Synthetic fixtures are allowed for development. Real Dam Sen plans, POIs, names, descriptions, photos and paths cannot enter production until the park owner/data owner grants appropriate rights.

At W0 review time, MapTiler Cloud's [official terms](https://www.maptiler.com/terms/cloud/) require on-screen attribution, permit only temporary per-end-user caching by default, and prohibit server-side caching/bulk download without an agreement. At the 2026-09 local research update, Geoapify's [map tile documentation](https://apidocs.geoapify.com/docs/maps/) requires OpenStreetMap attribution and also Geoapify attribution on the Free plan. If underlying OpenStreetMap data is shown, display `© OpenStreetMap contributors` linked to the [OSM copyright page](https://www.openstreetmap.org/copyright) and satisfy the ODbL. These links must be rechecked at each production release because service terms can change.

## Required production gate

Before public staging/production, the release owner must record:

- provider account/plan and current terms approval;
- attribution text and placement screenshot;
- OSM or other underlying-data attribution/ODbL obligations, where applicable;
- park-owner permission for the internal plan and content;
- whether caching/offline use is allowed, including duration and storage limits.

Terms and pricing change, so this ADR intentionally does not encode a perpetual quota or price. The release checklist must link the then-current official terms.

## Consequences

Map rendering and provider choice remain separable. Network tiles are required in MVP; full offline maps are V1 and require a new licensing review. A self-hosted tile service is a valid later substitution but adds build, update and infrastructure ownership.

## Alternatives rejected

- Google Maps SDK: useful but creates more provider coupling for custom rendering/offline policy.
- Unattributed public tile endpoints: unsuitable for production load and license compliance.
- Building a tile stack during MVP: distracts from the higher-risk walkway/routing problem.
