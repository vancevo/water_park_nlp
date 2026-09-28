# ADR 0001: Application stack and deployment shape

- Status: Accepted
- Date: 2026-09-24

## Context

The MVP needs mobile GPS/audio/navigation, an admin CMS and spatial APIs while remaining understandable for a computer-science learning project. The expected scale is one park, so distributed streaming/search infrastructure is premature.

## Decision

- Use a TypeScript monorepo.
- Mobile: React Native with Expo.
- Admin: Next.js.
- Backend: NestJS modular monolith plus a separate worker process for asynchronous jobs.
- Contract: OpenAPI is the HTTP source of truth; mobile/admin consume a generated TypeScript client.
- Database: PostgreSQL with PostGIS. Add pgvector only when the V1 semantic-search task starts.
- Cache/jobs: Redis and BullMQ, introduced only for a measured cache or asynchronous job need.
- Local services run in Docker Compose; production artifacts are Docker images built by GitHub Actions.

T01 pins supported runtime/framework versions and records dependency licenses. Packages must not float on `latest`.

### Core license disposition

The following licenses are acceptable for this educational MVP, subject to preserving notices/source obligations. This approves the technology families, not an unchecked future version:

| Component | Expected upstream license | W0 disposition |
|---|---|---|
| React Native, Expo, Next.js, NestJS, BullMQ | MIT | Approved |
| PostgreSQL, pgvector | PostgreSQL-style license | Approved |
| PostGIS | GPL-2.0-or-later | Approved for server use; preserve notices/source obligations when distributing images |
| pgRouting | GPL-2.0-or-later, with separately licensed portions | Approved under the same distribution condition; see [upstream license summary](https://github.com/pgRouting/pgrouting#license) |
| MapLibre React Native | MIT | Approved; see [upstream license](https://github.com/maplibre/maplibre-react-native/blob/main/LICENSE.md) |
| Redis | License varies by release | Approved as an optional protocol-compatible cache/job dependency; T02 must pin and inventory an acceptable release before enabling it |
| MinIO (local only) | AGPL-3.0 | Approved for an unmodified local container with notices/source obligations preserved |

Every direct and transitive package still requires an automated license inventory after the lockfile exists. Exact Redis licensing varies by selected release and is a mandatory T02 check, not permission to accept arbitrary terms. Copyleft/server terms and mobile binary notices receive manual review before distribution. Unknown, unlicensed, source-available-only or prohibited licenses fail the build/release review rather than being silently accepted.

## Consequences

One language reduces contract friction and a modular monolith keeps transactions/debugging simple. Module boundaries must still be enforced so routing/search/workers can be extracted later. Kafka, Flink, Elasticsearch/OpenSearch, Neo4j and a feature store are explicitly deferred.

## Alternatives rejected

- Microservices: operational and contract cost is unjustified for MVP traffic/team size.
- Native iOS/Android apps: duplicate delivery effort for no validated MVP requirement.
- Elasticsearch from day one: PostgreSQL spatial/full-text facilities cover initial corpus size.
