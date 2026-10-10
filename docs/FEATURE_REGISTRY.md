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
| FND-PG-POOL | ready | `createPgPool<T>(connectionString, label)` | `apps/api/src/common/pg-pool.ts` | `pg-pool.test.ts` + I04 DB-restart drill | I04 | Use for every API `pg` pool: idle-client `error` is logged (code only) instead of crashing the process; worker pool has the same listener |
| FND-UUID-SHAPE | ready | `ParseUuidShapePipe` (8-4-4-4-12 hex, any version/variant) | `apps/api/src/common/uuid-shape.pipe.ts` | `tts-job.http.test.ts` (md5-seeded ids) | I04 | Narration/TTS job id params (md5-seeded ids); POI ids keep `ParseUUIDPipe({ version: '4' })` |
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
| MEDIA-UPLOAD | ready | `POST /v1/admin/media/presign` + signed playback | `apps/api/src/narration/media-*` | unit/HTTP + `media-storage.test.ts`; MinIO (dev build) smoke + integrity probe PASS (I04; B03 mitigated, awaiting approval) | T24, I04 | 5-min PUT/10-min GET; `content-type`, `x-amz-checksum-sha256`, `x-amz-meta-sha256` are SIGNED headers (`SIGNED_UPLOAD_HEADERS`) — clients must send exactly `requiredHeaders`; the bucket's CORS must allow `PUT` with those headers from the admin origin (I04 F9); verifies object metadata before review |
| NARRATION | in_progress | Public/admin APIs + editor + mobile player | `apps/api/src/narration/`, `apps/admin-web/components/narration-panel.tsx`, `apps/mobile/src/features/poi/` | HTTP/DB + 7 admin + 11 mobile narration/playback tests | T25 | Transcript fallback/player ready; public `audio.generatedBy` (contract v1.2, AI provenance without job id) for an "AI-generated" label; storage verified on a MinIO dev build (I04, B03 approval pending); offline byte cache remains |
| NARRATION-LOCALE-CONFIG | ready | `GET /v1/narration-locales` + `config/narration-locales.json` + dynamic narration locale read/write | `packages/config/src/narration-locales.ts`, `apps/api/src/narration/narration-locales.*`, `infra/migrations/009_*`, ADR 0007 | 19 config + 8 service unit tests + endpoint HTTP test | C02 (T25A/T25B backend) | Backend config/endpoint/fallback/write-validation; verified with the real UI at I01/I03 (FR via config, fallback); UI/POI locales remain vi/en |
| NARRATION-LOCALE-UI | in_progress | Admin `NarrationLocaleCatalogPort` + catalog tabs; visitor `useVisitorNarration`/`NarrationSection` (selector, preference, fallback notice, audio-first + speechTag, "AI-generated" label from `audio.generatedBy` via `lib/ai-audio-label.ts`) | `apps/admin-web/lib/narration-locales.ts`, `apps/admin-web/components/narration-panel.tsx`, `apps/visitor-web/lib/narration-{locales,source}.ts`, `apps/visitor-web/components/narration-section.tsx` | 6 admin + 12 visitor unit tests + 2 browser smoke scripts (`SMOKE_MODE=demo|api`) | Tú (T01–T03, I01) | Default `api` = `getNarrationLocales`, verified against the real catalog incl. a config-added FR (I01); fixture VI/EN/FR via `NEXT_PUBLIC_NARRATION_DATA_MODE=demo`; visitor interface i18n vi/en via `apps/visitor-web/lib/ui-text.ts` (typed dictionary, remembered, `<html lang>`/title); illustrated map layer (Old/New switch by the zoom buttons; `apps/visitor-web/public/maps/damsen-map.*`, fit script, `frontend-illustrated-map-report.md`) |
| TTS-GENERATION-UI | ready | `TtsGenerationPort` (fixture lifecycle + HTTP adapter incl. `latest`), `ttsJobReducer` (`job_restored`)/`ttsGenerationGuard`/`aiAudioAttachment`, `useTtsJob`, `TtsGenerationPanel`, `NarrationAudioPreview` | `apps/admin-web/lib/tts-{generation,job-machine}.ts`, `apps/admin-web/hooks/use-tts-job.ts`, `apps/admin-web/components/{tts-generation-panel,narration-audio-preview}.tsx` | admin unit tests (tts-generation, tts-job-machine, narration-admin-client) + admin browser smoke (`SMOKE_MODE=demo|api`) | Tú (T01/T04, I01, I03) | Contract v1.1: draft audio via admin playback URL with `audioGeneratedBy` provenance (also in history), resume after reload via `…/tts-jobs/latest`, Vietnamese copy for v1.1 request/job codes + 429 retry hint; `NEXT_PUBLIC_TTS_GENERATION_MODE` default `off`, fail-closed (explicit `api` build verified at I03; go-live at I04); verified E2E with the real worker (I03 report) |
| MOBILE-NARRATION-LOCALE | ready | `toNarrationLocaleCode`, `NarrationClient` with `NarrationLocaleCode` | `apps/mobile/src/features/poi/narrationLocale.ts`, `httpNarrationClient.ts` | 4 locale + 4 HTTP narration tests | Tú (T05) | Any BCP 47 tag; no new mobile UI (ADR 0006) |
| TTS-EVAL-CORPUS | ready | Versioned corpus/lexicon/manifest/thresholds/report schema + `validate.py` (`--export-benchmark`) | `data/tts-evaluation/` | validator + 15 unittest cases | Tú (T06/AI01, I03) | Synthetic original VI/EN/FR text; evaluation-only; lexicon awaits native review; export matches worker benchmark shape; I03 pipeline-check report (full corpus, fake tone provider, gate fails on missing human ratings) in `reports/fixtures/` |
| AI-TTS-GENERATION | planned | Async reviewed TTS generation + provider registry | `docs/plans/AI_TTS_AND_TRAINING_ROADMAP.md` | licensed corpus benchmark + provider/HTTP/UI/ops checks | AI00–AI08 | Piper baseline; ZeroTTS/MOSS benchmark; fine-tune only after explicit GO |
| TTS-WORKER-FOUNDATION | in_progress | `TtsProvider` port + `TtsGenerationService` + model/voice registry | `apps/worker/src/tts/**`, `infra/migrations/010_*`, ADR 0008 | 18 worker unit tests (idempotency/retry/timeout/dead-letter/cancel/registry/audio) | C03 (AI02) | Provider-neutral, idempotent, offline; reproducible artifact manifest; draft-only; no real engine yet (AI03) |
| TTS-PIPER-BASELINE | in_progress | `PiperTtsProvider` (native binary) + voice manifest + CPU benchmark | `apps/worker/src/tts/piper/**`, `config/tts-voices.example.json`, `scripts/setup-piper-voices.mjs`, ADR 0009 | 15 worker unit tests (wav/adapter/manifest/benchmark) | C04 (AI03) | Native (no Docker, ~150 MB); synthesis/benchmark run locally, CI uses a mocked runner; I04 closure: real voices vi/en/fr in `config/tts-voices.json` (+ `data/tts-evaluation/run_real_voice_check.py`, `scripts/e2e-tts-real-storage.mjs`) |
| ADMIN-TTS-JOB-API | in_progress | `POST /v1/admin/narrations/:id/tts-jobs` + `GET`/`cancel` `/v1/admin/tts-jobs/:id`; v1.1 `GET …/tts-jobs/latest`, `GET /v1/admin/narrations/:id/audio/playback`, job `artifact`, `AdminNarration.audioGeneratedBy` | `apps/api/src/narration/admin-tts-job.controller.ts`, `tts-job.service.ts`, `tts-job-controls.ts`, `{in-memory,postgres}-tts-job.repository.ts`, `tts-job.{models,dto}.ts`, `tts-hash.ts`, ADR 0010/0014 | service/HTTP/defaults/OpenAPI-contract tests (RBAC, draft-only, idempotency, conditional cancel, kill switch, quota, submit lock) | AI04, I02 | Draft-only; EDITOR/ADMIN create; 503 `AI_FEATURE_DISABLED`, 429 `rate_limited`/`concurrency_limited`, 409 `NARRATION_NOT_DRAFT`/`TTS_JOB_IN_PROGRESS`; stamps voices from `TTS_VOICES_MANIFEST_PATH` |
| TTS-QUEUE-CONSUMER | in_progress | `TtsJobConsumer`, `TtsJobRunner`, `TtsJobQueue` (Postgres/in-memory), `TtsAudioStore` (S3/in-memory), `startWorker()` | `apps/worker/src/tts/{tts-job-runner,tts-job-queue,postgres-tts-job-queue,in-memory-tts-job-queue,tts-audio-store,tts-worker-runtime}.ts`, `apps/worker/src/worker.ts`, `infra/migrations/012_*`, ADR 0014 | runner/consumer unit tests + opt-in real-DB queue test (`TTS_QUEUE_TEST_DATABASE_URL`) + live smoke | I02 | Atomic claim (SKIP LOCKED), cancel-safe conditional writes fenced by a per-claim `lease_token`, stale re-claim (keeps spent attempts → `TTS_WORKER_LOST`), WAV → S3 → draft attach + AI provenance in one transaction; kill switch + `QuotaGuard`; Piper or CLI engine; optional mp3/m4a release encoding via ffmpeg (`tts/audio-encoder.ts`, `TTS_AUDIO_RELEASE_FORMAT`, contract v1.3) |
| TTS-PROVIDER-BENCHMARK | in_progress | `CliTtsProvider` (ZeroTTS/MOSS…) + multi-provider comparison harness + report validator + fixed thresholds | `apps/worker/src/tts/providers/**`, `config/tts-benchmark-providers.example.json`, `config/tts-benchmark-thresholds.json`, ADR 0011 | 21 worker unit tests (cli-adapter/manifest/harness/validator) | C05 (AI05) | Same normalized inputs + input hashes; blind-label map; CPU default (GPU via `TTS_BENCHMARK_INCLUDE_GPU`); recommendation names hardware+license; real engines + full corpus at I03; `npm run tts:benchmark-providers` |
| AI-OPS-HARDENING | in_progress | Metrics + quota + retention + kill-switch for the AI/TTS pipeline | `apps/worker/src/ops/**`, `infra/observability/**`, `infra/migrations/011_*`, ADR 0013, `docs/runbooks/backend-ai-operations.md` | 20 worker unit tests (metrics/quota/retention/flags) | C07 (AI08) | Prometheus+JSON metrics (PII-safe), `QuotaGuard`, retention selector, `TTS_GENERATION_ENABLED` kill switch (wired into API + worker in I02), `QuotaGuard.peek`, alerts; I04 fault-injection + model/flag/migration-012 rollback drills PASS on a real stack (`docs/runbooks/backend-i04-release-gate.md`); 2026-10-10: worker `GET /metrics`+`/healthz` (`ops/metrics-server.ts`, `metrics-server.test.ts`), `scripts/storage-restore-drill.mjs` (audit/backup/restore/drill) and `scripts/load-test.mjs` |

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
| SEARCH-LEXICAL | ready | `GET /v1/search`, `DamSenApiClient.search()` | `apps/api/src/search/`, `infra/migrations/007_*` | 8 tests + `search-geo-intent.test.ts` + real DB + 50-query HTTP eval | T40/C06 | Accent/typo strong; L3 OR/min-match + L4 cardinal-direction intent (`search-geo-intent.ts`): live Recall@10 0.956 ≥ ADR 0012 gate; semantic synonyms still need embeddings |
| SEARCH-EVAL | ready | 50-query judgments + metrics | `data/search-evaluation/` | validator + 3 regression tests | T41 | Recall@10/MRR/nDCG@10 + zero-result accuracy |
| SEARCH-EMBED | in_progress | `EmbeddingService` + repository/provider ports | `apps/worker/src/embedding/`, `infra/migrations/005_*` | 5 unit tests + real schema migration | T42 | Hash-idempotent 1024d versioned storage; production model/provider benchmark remains |
| SEARCH-HYBRID | in_progress | RRF hybrid re-ranking behind a feature flag + lexical fallback | `apps/api/src/search/hybrid-ranking.ts`, `search-flags.ts`, `query-embedder.ts`, `{in-memory,postgres}-vector.source.ts`, `search.service.ts`, ADR 0012 | 25 unit tests (fusion/flags/embedder/hybrid+fallback) | T43 (AI07) | `SEARCH_HYBRID_ENABLED` off by default; strict re-rank of lexical pool (set/total unchanged); fail-closed to lexical; `semantic` reason added; prod embedding endpoint + 50-query eval at I03 |

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
