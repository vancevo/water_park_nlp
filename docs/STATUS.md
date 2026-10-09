# Project Status Board

Đây là file agent đọc hằng ngày. Giữ file ngắn; không chép log hoặc mô tả implementation vào đây. Chi tiết task nằm trong [AGENT_EXECUTION_PLAN.md](AGENT_EXECUTION_PLAN.md), capability dùng lại nằm trong [FEATURE_REGISTRY.md](FEATURE_REGISTRY.md).

## Current state

- Current wave: `W5/W6 — Search, analytics and release hardening`
- Integration status: `SEARCH_ANALYTICS_POSTGIS_PASS`
- Active blockers: B01 blocks public map/content release; B03 (real MinIO/S3) gates I04 only — I02 smoke ran on an S3 emulator
- Last updated: 2026-10-09
- Updated by: Tú (I03 acceptance)

## Task board

| Task | Status | Owner | Depends on | Handoff/result |
|---|---|---|---|---|
| T00 Product contract | DONE | product agent | — | `docs/product/MVP_SCOPE.md` |
| T00A Stack/provider ADR | DONE | product agent | — | `docs/adr/0001`–`0005` |
| T01 Monorepo bootstrap | DONE | foundation agent | T00, T00A | Root workspace builds/tests pass |
| T02 Local infra/config | DONE | coordinator | T01 | Spatial PostgreSQL Docker + typed config verified |
| T03 API conventions/client | DONE | POI API agent | T01 | OpenAPI, shared DTO and typed client compile |
| T04 Test foundation | DONE | coordinator | T01, T03 contract | API HTTP/unit, mobile/config/admin tests + geo validator |
| T05 CI baseline | DONE | coordinator | T01–T04 | GitHub quality + fixture-contract jobs |
| T10–T12 Auth/RBAC/mobile session | IN_PROGRESS | API/mobile agents | W1 | Admin browser login + opt-in dev seed verified; encrypted mobile persistence waits on B02 |
| T20 POI schema | DONE | POI API agent | W1 | Migrations 001–003 applied to local PostGIS |
| T21 Public POI API | DONE | POI API agent | T20, T03 | Real DB list/detail smoke pass with 5 POIs |
| T22 Admin POI CRUD | DONE | API/admin agents | T10–T11, T20 | Real backend contract + Next production build + adapter tests |
| T23 Workflow/audit | DONE | API/admin agents | T22 | Submit/approve/reject/reason/audit + status-driven UI |
| T24–T25 Media/narration | IN_PROGRESS | API/mobile/admin agents | T21–T23 | Workflow, signer, admin preview and mobile player pass; B03 real storage smoke + offline audio cache remain |
| T25A/T25B Configurable narration locales (backend, C02) | IN_PROGRESS | Công backend | T24–T25, C01 | Config loader + `GET /v1/narration-locales` + fallback + write validation + migration 009 + ADR 0007 on `codex/cong-c02-locale-backend`; T25C–E (Tú) + integration I01 pending |
| T01–T07 Narration locale UI, AI TTS UX, mobile BCP 47, TTS eval corpus (T25C–E, AI01, AI04 UI) | DONE (mock/fixture level) | Tú | contract v1 | Merged (PR #9): mock ports + fixtures, admin tabs/AI generation (save/submit locked while a job runs), visitor selector, mobile transport, `data/tts-evaluation`; runbook `docs/runbooks/frontend-narration-locales-tts.md`. Full T25C–E/AI04 acceptance (real catalog with FR, real jobs/audio) closes only at I01–I04 |
| I01 Adapter swap (narration locales + TTS jobs) | DONE | Tú | T01–T07, C01–C07, I02 | Real catalog + AI endpoints in the browser; after I02 the real E2E runs through the real worker process (no claim harness) — I03 report §3.2; findings that drove I02: `docs/runbooks/frontend-i01-integration-report.md` |
| AI00–AI08 AI/TTS/search hardening | IN_PROGRESS | Công backend / Tú UX+eval | T41–T42 | AI02–AI05, AI07, AI08 merged; I02 wires the AI08 kill switch/quota into API + worker (ADR 0014); live scrape endpoint + storage-restore (B03) deferred; AI06 requires explicit GO; remaining for Công = I04 |
| I02 Contract/integration fixes | REVIEW | Công (executed on Tú's request) | I01 | `cong/i02-i04`: worker queue consumer (claim/cancel-safe/attach audio + AI provenance to draft), AI08 kill switch + quota in API/worker, draft-only create + submit/PATCH lock, OpenAPI errors, voice-manifest stamp, contract v1.1 additive (ADR 0014), migration 012; all 11 I01 issues fixed — `docs/runbooks/backend-i02-integration-fixes.md`. Live smoke: real API + worker + Postgres + S3 **emulator** (moto) + fake CLI tone provider (Piper voices blocked). Reviewed 2026-10-09: claim lease fencing, stale re-claim dead-letter, succeeded-idempotency vs replaced audio, S3 call timeout fixed; admin UI (unchanged) passes the api-mode browser smoke against the I02 API |
| I03 End-to-end acceptance | PARTIAL | Tú | I01, I02 | `tu/i03-acceptance`: admin UI on contract v1.1 (playback + AI provenance, latest-job resume, new error codes; TTS flag default stays `off`, fail-closed — go-live at I04). Real stack (API :3000 + real worker + Postgres `damsen_i03` + moto S3 + fake tone provider): FR via config, transcript → generate → draft audio → review → publish, visitor locale audio/fallback, hybrid flag on/off **PASS** (functional only: identical metrics in all modes, live recall 0.600 vs baseline 0.911 → I04); T06 corpus benchmark only a pipeline check (fake provider, no blind review) → box 4 open. Report + issues for Công: `docs/runbooks/frontend-i03-acceptance-report.md` |
| T30 Mobile map | DONE | mobile agent | T21 contract | Typecheck + 10 shared mobile tests pass |
| T31 GPS session | DONE | mobile agent | T30 | Permission/signal state machine + explicit follow mode |
| T32 Walkway graph | DONE | geo agent | W1 | 7-node/8-edge fixture, topology validator and migration 004 |
| T33 Routing API | DONE | routing agent | T21, T32 | Real pgRouting API smoke pass (step-free N1→N7) |
| T34 Mobile navigation | DONE | mobile navigation agent | T31, T33 | Navigation state machine + GPS simulation + route client |
| T35 Visitor web | DONE | web agent | T10, T21, T24, T33, T40 | Responsive web on `:3002`: Geoapify, 5 OSM-referenced POIs, 54 walkway ways, GPS and research route |
| T35-SIM Walking simulation | DONE | web agent | T24–T25, T33, T35 | Click-to-place visitor, 1–3 m route steps, arrival dialog and browser TTS; 5 visitor tests + build pass |
| T35-SIM2 Auto chibi simulation | DONE | web agent | T35-SIM | Five-second elapsed-time playback, detail closes on guidance, 6-frame indie spritesheet; 6 visitor tests + build pass |
| T35-SIM3 Compact controls | DONE | web agent | T35-SIM2 | Compact-by-default simulation pill with accessible expand/collapse; visitor checks pass |
| T35-SIM4 Preserve map zoom | DONE | web agent | T35-SIM3 | Simulation preserves current zoom; real-GPS routes retain fitBounds; visitor checks pass |
| T40 Lexical/spatial search | DONE | search agent | W2, W4 | API + migration 007 + real DB smoke; HTTP eval Recall@10 0.60 |
| T41 Search evaluation | DONE | search evaluation agent | T40 | 50-query VI/EN dataset reconciled with authoritative fixtures |
| T42 Embedding pipeline | IN_PROGRESS | worker agent | T41 | Versioned/hash-idempotent pipeline + pgvector schema; production provider benchmark remains |
| T43 Hybrid ranking | IN_PROGRESS | Công backend | T40–T42 | RRF re-ranking + `SEARCH_HYBRID_ENABLED` flag + lexical fallback + `semantic` reason on `codex/cong-ai07-hybrid-search` (ADR 0012); prod embedding endpoint + 50-query eval at I03 |
| T50 Offline/cache | TODO | unassigned | W3, W4 | — |
| T51 Event batching | DONE | analytics agent | W1 | Migration 008 + consent/idempotency/privacy tests + real DB retry smoke |
| T52 Observability/security | TODO | unassigned | W1–W5 | — |
| T60 Staging release | TODO | unassigned | W6 | — |
| T61 Field test | TODO | unassigned | T60 | — |
| T62 MVP acceptance | TODO | unassigned | T61 | — |

Status hợp lệ: `TODO`, `READY`, `IN_PROGRESS`, `REVIEW`, `DONE`, `BLOCKED`.

## Blockers

| ID | Affects | Owner | Needed decision/action | Status |
|---|---|---|---|---|
| B01 | Production release | coordinator | Confirm Dam Sen content/map rights and provider terms; field-verify POIs, entrances and OSM paths | OPEN; OSM snapshot powers local research demo only and is visibly marked unverified |
| B02 | Legacy mobile prototype | mobile/platform | Add SecureStore/Keychain adapter and verify iOS/Android native builds only if native distribution resumes | DEFERRED by ADR-0006; no longer blocks visitor web |
| B03 | Local media smoke | platform | Authenticate Docker to Quay or supply an approved S3-compatible image; rerun `scripts/smoke-media.mjs` | OPEN for real MinIO/S3 (no Docker daemon here; `dl.min.io` 403). I02 ran `smoke-media.mjs` + the TTS upload on the moto S3 emulator (dev-only; does not enforce SigV4/checksum) |

## Recent decisions

Chỉ ghi ID và link ADR; không ghi lại nội dung ADR.

| ADR | Decision | Date |
|---|---|---|
| ADR-0001 | Modular monolith stack | 2026-09-24 |
| ADR-0002 | MapLibre/provider and data rights | 2026-09-24 |
| ADR-0003 | PostGIS/pgRouting | 2026-09-24 |
| ADR-0004 | S3-compatible media and reviewed audio | 2026-09-24 |
| ADR-0005 | On-device GPS progress and privacy | 2026-09-24 |
| ADR-0006 | Web-first visitor client | 2026-09-25 |
| ADR-0014 | TTS queue consumer, draft-audio attach, contract v1.1 (additive) | 2026-10-09 |

## Update checklist

- [ ] Chỉ một owner cho task `IN_PROGRESS`.
- [ ] Dependency đã `DONE` trước khi chuyển task sang `READY`.
- [ ] Handoff/result là link hoặc mô tả một dòng.
- [ ] Blocker có owner và action cụ thể.
- [ ] Feature registry được cập nhật trước khi task thành `DONE`.
- [ ] Xóa thông tin tiến độ lỗi thời; không để file tăng thành nhật ký dài.
