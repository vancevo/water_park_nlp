# ADR 0005: GPS processing and analytics privacy

- Status: Accepted for MVP; production retention review required
- Date: 2026-09-24

## Context

Precise location is needed transiently for routing but a stored movement trail is not required for the core experience. GPS can identify or expose sensitive visitor behaviour.

## Decision

- Request foreground/while-in-use location only, after a just-in-time explanation.
- Browse/search/narration remain usable when permission is denied; routing requires an explicit start point/current usable location.
- Compute route progress, snapping display and off-route sampling on-device where practical.
- Exact start coordinates may be processed by the routing endpoint but are not persisted in route history, analytics or application logs. Coordinate-bearing request bodies are redacted.
- Do not collect background GPS or raw traces in MVP.
- Product analytics requires a consent choice and uses versioned events without exact coordinates, route geometry or advertising IDs.
- Separate account identity from a random resettable installation/session identifier. Access to operational data follows least privilege.
- A research/field-test trace collector requires explicit opt-in, separate UI, purpose, access list, precision reduction and deletion date; it is not enabled in a public build under this ADR.

## Retention gate

Before a production launch, product/legal/security owners must approve a retention schedule for accounts, refresh sessions, audit logs, operational logs and analytics events, plus deletion/withdrawal procedures. Until then, only synthetic/test identities may be used in shared staging and no raw GPS trace may be retained.

## Consequences

The app can navigate without building a movement database. Some future personalization/heatmap ideas will lack raw data; enabling them requires a new purpose-specific consent and ADR. Debugging routing relies on synthetic replay and deliberately opted-in field-test fixtures rather than production traces.

