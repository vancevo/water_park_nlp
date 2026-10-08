# Feature Registry

Đây là chỉ mục ngắn về capability đã có. Agent phải tra file này trước khi tạo mới và cập nhật nó trong cùng task khi feature trở nên dùng được.

## Cách ghi

Mỗi entry dùng format:

```text
ID | Status | Public interface | Implementation path | Tests | Owner/Task | Notes
```

Status hợp lệ: `planned`, `in_progress`, `ready`, `deprecated`, `blocked`.

Không ghi chi tiết implementation dài tại đây. Link tới README, OpenAPI, ADR hoặc code. Một feature chỉ là `ready` khi test và public interface đã ổn định cho consumer kế tiếp.

## Shared foundations

| ID | Status | Public interface | Implementation | Tests | Owner/Task | Notes |
|---|---|---|---|---|---|---|
| FND-REPO | ready | Workspace scripts | `package.json`, workspace config | root lint/typecheck/test/build | T01 | Node 24/npm workspaces |
| FND-CONFIG | ready | Typed environment config | `packages/config/` | 4 unit tests | T02 | PostgreSQL/Redis/S3 validation + production-required values |
| FND-TYPES | ready | Shared DTO primitives | `packages/shared-types/` | typecheck | T03 | Health/auth/POI/admin DTOs |
| FND-ERROR | ready | `{code,message,details,requestId}` | `apps/api/src/common/` | smoke | T03 | Global filter + request ID |
| FND-API-CLIENT | ready | Typed TypeScript client | `packages/api-client/` | typecheck + API HTTP tests + browser smoke | T03 | Auth/public/admin POI operations; browser-native fetch is context-bound |
| FND-TEST-DATA | ready | Deterministic GeoJSON fixtures | `data/geojson/` | `python3 data/geojson/validate.py` | T04/T32 | 5 POIs, 5 entrances, connected mini graph |
| FND-RESEARCH-DATA | ready | Draft-only public-fact catalogue + generated geometry | `data/research-damsen/` | generator + validator | research | 24-POI catalogue remains isolated; generated geometry explicitly non-navigable |
| OSM-RESEARCH-MAP | ready | OSM-referenced 5-POI dev fixture + walkway overlay/graph | `apps/api/src/poi/poi.fixtures.ts`, `apps/api/src/routing/damsen-osm-network.ts`, `apps/visitor-web/public/data/` | API 42 tests + visitor lint/typecheck/build | T35-OSM | 54 ways/360 nodes; attribution shown; not field verified |

## Identity and access

| ID | Status | Public interface | Implementation | Tests | Owner/Task | Notes |
|---|---|---|---|---|---|---|
| AUTH-SESSION | ready | Register/login/refresh/logout API | `apps/api/src/auth/` | HTTP + real DB smoke | T10 | Native Node 24 Argon2id; rotating hashed refresh token |
| AUTH-RBAC | ready | Guards + roles | `apps/api/src/auth/rbac.ts` | negative HTTP tests | T11 | VISITOR/EDITOR/REVIEWER/ADMIN |
| AUTH-DEV-SEED | ready | Opt-in development `ADMIN` seed | `AuthService.onModuleInit()` + `.env.example` | API tests + live browser login | T10 | Requires `DEV_SEED_ADMIN=true`; hard-disabled in production |
| AUTH-VISITOR-WEB | ready | Guest + register/login/logout UI | `apps/visitor-web/` | typecheck/build + browser smoke | T12W | Session scoped to browser tab |
| AUTH-MOBILE | in_progress | Guest/login/signup/session UI + `SessionManager` | `apps/mobile/src/features/auth/` | 8 auth unit tests | T12 | Memory-only safe adapter; SecureStore/Keychain blocked by B02 |

## POI and multilingual content

| ID | Status | Public interface | Implementation | Tests | Owner/Task | Notes |
|---|---|---|---|---|---|---|
| POI-SCHEMA | ready | POI/category/translation/entrance/hours schema | `infra/migrations/001_*`, `002_*` | real PostGIS migration + seed | T20 | Media schema remains T24 |
| POI-READ | ready | `GET /v1/pois`, `GET /v1/pois/:id` | `apps/api/src/poi/` | 10 POI/API tests + real DB smoke | T21 | locale fallback + radius/category/open-now |
| POI-WRITE | ready | Admin CRUD | API admin POI + `apps/admin-web/` | HTTP + 7 admin tests + production build | T22 | Bearer session; backend RBAC authoritative |
| POI-WORKFLOW | ready | submit/approve/reject | API content + admin web | HTTP + adapter/workflow tests | T23 | Dedicated transitions; rejection reason + audit |
| MEDIA-UPLOAD | in_progress | `POST /v1/admin/media/presign` + signed playback | `apps/api/src/narration/media-*` | unit/HTTP; real MinIO smoke blocked by B03 | T24 | 5-min PUT/10-min GET; verifies object metadata before review |
| NARRATION | in_progress | Public/admin APIs + editor + mobile player | `apps/api/src/narration/`, `apps/admin-web/components/narration-panel.tsx`, `apps/mobile/src/features/poi/` | HTTP/DB + 7 admin + 11 mobile narration/playback tests | T25 | Transcript fallback/player ready; real S3 smoke B03 and offline byte cache remain |
| NARRATION-LOCALE-CONFIG | in_progress | `GET /v1/narration-locales` + `config/narration-locales.json` + dynamic narration locale read/write | `packages/config/src/narration-locales.ts`, `apps/api/src/narration/narration-locales.*`, `infra/migrations/009_*`, ADR 0007 | 19 config + 8 service unit tests + endpoint HTTP test | C02 (T25A/T25B backend) | Backend config/endpoint/fallback/write-validation on `codex/cong-c02-locale-backend`; UI T25C–E + integration I01 pending; UI/POI locales remain vi/en |
| AI-TTS-GENERATION | planned | Async reviewed TTS generation + provider registry | `docs/plans/AI_TTS_AND_TRAINING_ROADMAP.md` | licensed corpus benchmark + provider/HTTP/UI/ops checks | AI00–AI08 | Piper baseline; ZeroTTS/MOSS benchmark; fine-tune only after explicit GO |
| TTS-WORKER-FOUNDATION | in_progress | `TtsProvider` port + `TtsGenerationService` + model/voice registry | `apps/worker/src/tts/**`, `infra/migrations/010_*`, ADR 0008 | 18 worker unit tests (idempotency/retry/timeout/dead-letter/cancel/registry/audio) | C03 (AI02) | Provider-neutral, idempotent, offline; reproducible artifact manifest; draft-only; no real engine yet (AI03) |
| TTS-PIPER-BASELINE | in_progress | `PiperTtsProvider` (native binary) + voice manifest + CPU benchmark | `apps/worker/src/tts/piper/**`, `config/tts-voices.example.json`, `scripts/setup-piper-voices.mjs`, ADR 0009 | 15 worker unit tests (wav/adapter/manifest/benchmark) | C04 (AI03) | Native (no Docker, ~150 MB); synthesis/benchmark run locally, CI uses a mocked runner |
| ADMIN-TTS-JOB-API | in_progress | `POST /v1/admin/narrations/:id/tts-jobs` + `GET`/`cancel` `/v1/admin/tts-jobs/:id` | `apps/api/src/narration/admin-tts-job.controller.ts`, `tts-job.service.ts`, `{in-memory,postgres}-tts-job.repository.ts`, `tts-job.{models,dto}.ts`, `tts-hash.ts`, ADR 0010 | 11 service unit tests + HTTP test (RBAC/enqueue/idempotency/poll/cancel/validation) | AI04 | API enqueues draft-only `queued` jobs to the shared `tts_generation_jobs` table; EDITOR/ADMIN only, no visitor, no auto-approve; worker claiming finalized in I01/AI05 |

## Map, GPS and routing

| ID | Status | Public interface | Implementation | Tests | Owner/Task | Notes |
|---|---|---|---|---|---|---|
| MAP-BASE | ready | Map screen/layers | `apps/mobile/src/features/map/` | typecheck + unit | T30 | MapLibre, native attribution, explicit follow mode |
| VISITOR-WEB | ready | Responsive POI map/search/detail/narration/GPS/route | `apps/visitor-web/` | lint/typecheck/build + browser smoke | T35 | Geoapify basemap, OSM-referenced POIs/walkways and synthetic basemap fallback |
| WALK-SIMULATOR | ready | Click-to-place visitor, compact controls, zoom-preserving 5-second route playback, 6-frame indie mascot spritesheet and arrival TTS | `apps/visitor-web/components/visitor-experience.tsx`, `apps/visitor-web/lib/route-simulation.ts`, `apps/visitor-web/public/chibi-walker-spritesheet.png` | 4 simulation tests + visitor lint/typecheck/build | T35-SIM4 | Simulation does not call fitBounds; real-GPS routes still do; reuses route geometry and approved narration transcript |
| GPS-SESSION | ready | Location state adapter | `apps/mobile/src/features/location/` | 8 unit tests across location/geo helpers | T31 | denied/approximate/precise/weak/unavailable states |
| GEO-GRAPH | ready | Validated WGS84 nodes/edges fixture + DB migration | `data/geojson/`, `infra/migrations/004_*` | topology validator + real DB | T32 | 7 nodes/8 edges; closure and step-free paths validated |
| ROUTE-API | ready | `POST /v1/routes` | `apps/api/src/routing/` | unit/HTTP + real pgRouting smoke | T33 | Dev in-memory graph uses OSM snapshot; DB graph remains migration-backed; both require field verification |
| NAV-SESSION | ready | Route progress/reroute state machine | `apps/mobile/src/features/navigation/` | GPS simulation + route client tests | T34 | 3-sample off-route debounce, cooldown, weak-signal suppression |
| GEOFENCE | planned | Proximity trigger policy | mobile/worker | unit/field | V1 | Không thuộc MVP core |

## Search and recommendation

| ID | Status | Public interface | Implementation | Tests | Owner/Task | Notes |
|---|---|---|---|---|---|---|
| SEARCH-LEXICAL | ready | `GET /v1/search`, `DamSenApiClient.search()` | `apps/api/src/search/`, `infra/migrations/007_*` | 8 tests + real DB + 50-query HTTP eval | T40 | Accent/typo strong; semantic/location slices intentionally weak before T43 |
| SEARCH-EVAL | ready | 50-query judgments + metrics | `data/search-evaluation/` | validator + 3 regression tests | T41 | Recall@10/MRR/nDCG@10 + zero-result accuracy |
| SEARCH-EMBED | in_progress | `EmbeddingService` + repository/provider ports | `apps/worker/src/embedding/`, `infra/migrations/005_*` | 5 unit tests + real schema migration | T42 | Hash-idempotent 1024d versioned storage; production model/provider benchmark remains |
| SEARCH-HYBRID | planned | Hybrid ranking | API search module | benchmark | T43 | Lexical + vector + spatial + open-now |

## Offline, analytics and operations

| ID | Status | Public interface | Implementation | Tests | Owner/Task | Notes |
|---|---|---|---|---|---|---|
| OFFLINE-CACHE | planned | POI/audio/map cache policy | mobile data layer | integration/E2E | T50 | Clear versioning/eviction |
| EVENT-BATCH | ready | `POST /v1/events/batch` | `apps/api/src/analytics/`, `infra/migrations/008_*` | 7 focused tests + real DB idempotency smoke | T51 | Consent-gated; allowlist payload; rejects raw GPS/PII; 30-day retention |
| AUDIT-LOG | ready | Admin audit query | API admin POI module + migration 003 | HTTP | T23 | All admin mutations record before/after |
| OBSERVABILITY | planned | Trace/log/error conventions | infra + apps | smoke | T52 | requestId end-to-end |
| CI-PIPELINE | ready | lint/typecheck/test/build + fixture validators | `.github/workflows/ci.yml` | local equivalent quality gate | T05 | Node 24 and Python contract jobs |

## Registry maintenance checklist

- [ ] Entry ID ổn định và không trùng.
- [ ] `ready` có public interface rõ và test pass.
- [ ] Path tồn tại.
- [ ] Consumer biết cách import/gọi, không phải đọc implementation.
- [ ] Breaking/deprecation có migration note.
- [ ] Task/handoff liên quan đã tham chiếu entry ID.
