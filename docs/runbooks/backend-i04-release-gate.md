# I04 — Release gate (Công, backend)

Definition: `docs/plans/CONG_TU_WORK_SPLIT.md` §5 I04. Branch
`cong/i04-release-gate` (stacks I01 → I02 → I03, merged with the final
`tu/i03-acceptance`). Date: 2026-10-09, Node 24, Python 3.13.
Inputs: `frontend-i01-integration-report.md`, `backend-i02-integration-fixes.md`,
`frontend-i03-acceptance-report.md`, `backend-ai-operations.md`, ADR 0004,
0008–0014.

## 0. Verdict

| Component | Verdict | Why |
|---|---|---|
| Object storage (B03) | **MITIGATED locally — not closed** | A MinIO *development* build compiled from the official Go module (§5) enforces SigV4, signed headers, expiry and `x-amz-checksum-sha256`; media smoke, full TTS E2E and an editor upload pass on it, and it surfaced and fixed a release blocker (every editor upload was rejected by real S3/MinIO). But B03 asks for Quay access or an **approved** S3-compatible image; a `DEVELOPMENT.GOGET` source build is not an approved image, and approving it is a coordinator decision. B03 stays open until the coordinator accepts this evidence or `smoke-media.mjs` passes on an approved image. |
| Narration locales (C02/T25A–E) | **GO** | I01/I03 PASS on the real API; disabled-locale fallback documented (§6c). |
| TTS pipeline: API + worker + review gate (I02) | **GO with the generation flag OFF** | All drills pass after three fixes (§3); draft-only + human review verified on real storage. |
| AI TTS for editors (`TTS_GENERATION_ENABLED` + `NEXT_PUBLIC_TTS_GENERATION_MODE=api`) | **NO-GO** | No real voice has ever run (Piper voices 403; only a sine-tone CLI fake), T06 corpus benchmark has no real provider and no blind review (I03 box 4), AI00 governance (voice consent / commercial-use review) not written. Keep backend kill switch `false` and frontend mode `off` (I03 review default). |
| Public "AI-generated" label | **GO (API)** / UI pending | Contract v1.2 field shipped (§6a); visitor UI label is Tú's follow-up. |
| Hybrid search (`SEARCH_HYBRID_ENABLED`) | **NO-GO to enable** (flag works) | On/off is functional and fails closed, but there is no production embedding endpoint/embeddings, and the live lexical baseline is 0.600 recall (§6b). Keep `false`. |
| Root quality gate | **PASS (local)** | §2. GitHub CI not run (branch not pushed). |
| **Overall release** | **NO-GO for public/AI release; GO to merge the backend with AI flags off** | B01 (content/map rights) is still open for any public release; AI TTS blocked by the voice/benchmark/governance items above; B03 awaits coordinator approval. |

I04's checklist: evidence aggregated and fault-injection/rollback drills run
(boxes 1–2 met). Box 3 ("DONE only when B03/real object storage and the root
quality gate pass") is **not** met: the root gate passed locally only (GitHub
CI not run) and B03 is mitigated with an unapproved dev build. **I04 was not
DONE** at the time of writing; it closes (§9) when the coordinator approves the MinIO evidence (or an
approved image reruns `scripts/smoke-media.mjs`) and CI passes on the branch.

## 1. Evidence matrix

Real vs emulated: Postgres 16 + PostGIS/pgvector/pgRouting, API and worker
processes, MinIO and HTTP flows are **real**; the TTS provider is a **fake**
CLI (`ffmpeg` sine tone, not a voice); embeddings in I03 were a **fake**
trigram hash; moto (S3 emulator) was used by I02/I03 and is superseded here by
MinIO.

| Item | Status | Evidence | Real / emulated |
|---|---|---|---|
| I01-1…11 (contract/integration issues) | Fixed in I02 | `backend-i02-integration-fixes.md` §1 | real API/worker; moto |
| I01 adapter swap | DONE | I03 report §1/§3.2 | real |
| I02 E2E (generate → draft → review → publish, cancel, failure, kill switch, quota) | PASS on MinIO | §4 `e2e-minio-main` | real MinIO; fake voice |
| I02 review fixes (lease fencing, stale dead-letter, succeeded-idempotency, S3 timeout) | PASS | DB int tests 6/6; drills §3 | real |
| I03-1 FR via config | PASS | I03 §3.1 | real |
| I03-2 transcript → publish in the browser | PASS | I03 §3.2 | moto; fake voice |
| I03-3 visitor locale audio / fallback | PASS | I03 §3.3 | moto |
| I03-4 T06 corpus through the chosen provider | **OPEN** | I03 §3.4 (pipeline check only) | fake voice |
| I03-5 hybrid on/off | PASS (functional) | I03 §3.5; §6b | fake embedder |
| AI00 governance ADR (label, license, consent, review gate) | **PARTIAL** | label/license/review in ADR 0004/0008/0014; no voice-consent / commercial-use review | — |
| AI01 eval corpus (Tú) | DONE | `data/tts-evaluation`, validator now in CI | — |
| AI02 worker foundation | DONE | worker tests; I02 consumer | real |
| AI03 Piper baseline | **BLOCKED** | code + mocked tests; voices 403 | never synthesized |
| AI04 admin generation | PASS (flag off) | I02/I03 | fake voice |
| AI05 provider benchmark | **OPEN** | harness + pipeline-check report only | fake voice |
| AI06 fine-tuning | not started (needs explicit GO) | ADR 0011 | — |
| AI07 hybrid search | functional, not production | §6b | fake embedder |
| AI08 drills: failed provider, full queue, corrupt audio, model rollback | PASS | §3, §4 | real processes |
| AI08 restore drill / metrics scrape endpoint | DONE 2026-10-10 (C07) | `backend-ai-operations.md` (drill on S3 emulator; re-run on target store at T60) | real processes, emulator storage |
| B03 real object storage | **MITIGATED (local), awaiting coordinator approval** | §5 | real MinIO protocol, dev build (not an approved image) |

## 2. Root quality gate (what CI runs, run locally)

| Command | Result |
|---|---|
| `npm run format:check` / `npm run lint` / `npm run typecheck` | pass |
| `npm run build` (all workspaces incl. both Next apps) | pass |
| `npm test` | pass — admin 56, api 113, mobile 47, visitor 18, worker 96 (+6 DB tests skipped without DB), config 23 |
| `TTS_QUEUE_TEST_DATABASE_URL=…/damsen_i04_dbtest npx vitest run --root apps/worker test/postgres-tts-job-queue.int.test.ts` | 6/6 |
| Migrations: 001→012 up, all 12 downs in reverse, 001→012 up again (fresh DB) | pass, no errors |
| `python3 data/{geojson,research-damsen,search-evaluation}/validate.py`, `search-evaluation/test_evaluation.py`, `tts-evaluation/validate.py` | pass |

CI change: `data/tts-evaluation/validate.py` and its self-test
`test_validate.py` added to the `fixture-contracts` job (standard library
only; both pass from a clean `git archive`). `npm ci` was not re-run (dependencies already
installed in the worktree).

## 3. Fault injection

Stack: API `:3300` and real worker processes (`apps/*/dist`), Postgres
`damsen_i04`, MinIO `:3391` (worker through a TCP fault proxy `:3393`, control
`:3394`), fake tone provider. Driver: `scratchpad/i04/drills.mjs` (not
committed); per-drill results in `scratchpad/i04/drill-results.jsonl`.

| Fault | Expected | Observed | Result |
|---|---|---|---|
| Idle DB connections terminated (`pg_terminate_backend`, as on DB restart/failover) | API + worker survive | **Before fix: both processes crashed** (unhandled pool `error`). After fix: both alive, reconnect | **Bug fixed** |
| DB refuses connections ~8 s during a running job | stable 5xx, no crash, job completes or is re-claimed | poll → `500 INTERNAL_ERROR` during the outage; processes alive; worker left the job `running`, re-claimed after the stale window → `succeeded` (attempts 2) | PASS (500 instead of 503: follow-up) |
| Worker SIGKILL mid-job | job re-claimed after `TTS_JOB_STALE_RUNNING_MS` | reads `running` while orphaned, re-claimed at 15 s → `succeeded`, attempts 2 | PASS |
| Job kills the worker on every attempt (3×) | dead-letter, no loop | `failed TTS_WORKER_LOST`, attempts 3/3, dead-lettered | PASS |
| Worker SIGTERM mid-job (deploy) | drain, exit 0 | job `succeeded`, exit 0 | PASS |
| S3 refuses connections for one attempt | retry succeeds | `succeeded`, attempts 2 | PASS |
| S3 down for all attempts | `TTS_STORAGE_ERROR`, dead-letter, draft untouched | `failed TTS_STORAGE_ERROR` 3/3, draft audio `null`; create after recovery re-queues same id → `succeeded` | PASS |
| S3 hangs (blackhole) > 60 s | per-call timeout, retry | aborted at 60 s, retried → `succeeded` in 67 s | PASS |
| Provider slower than `TTS_JOB_TIMEOUT_MS` | `TTS_TIMEOUT` after 3 attempts | `failed TTS_TIMEOUT` 3/3; **3 provider processes still running** after the job failed | PASS, follow-up F5 |
| Provider process SIGKILLed mid-synthesis | retry succeeds | `succeeded`, attempts 2, worker alive | PASS |
| Provider exits 0 with a non-WAV file | `TTS_AUDIO_INVALID`, nothing attached | before fix `TTS_PROVIDER_ERROR`; after fix `TTS_AUDIO_INVALID`, draft audio `null` | **Fixed** |
| Worker kill switch flipped mid-queue (3 jobs, 1 running) | in-flight drains, rest stay queued | `succeeded, queued, queued` | PASS |
| API kill switch | create 503, poll/cancel work | `503 AI_FEATURE_DISABLED`; poll 200; cancel 200 | PASS |
| Kill switch back on | queued jobs run without resubmission | `running → succeeded` | PASS |
| Worker quota (1 concurrent, 2 per 20 s), 4 jobs | ≤1 running, rest wait | max running 1; 2 done at 6 s, 3–4 queued until the next window; all done at 26 s | PASS |
| API quota (`TTS_QUEUE_MAX_ACTIVE=1`, 2 per window) | 429 codes | `429 concurrency_limited`, then `429 rate_limited {retryAfterSeconds: 600}` | PASS |
| 25× create/re-queue ↔ cancel at random points | one row, final run succeeds, draft audio belongs to a succeeded job with matching sha | 1 row; 15 cancels landed, 10 hit `succeeded`; final `succeeded`; 0 invariant violations; worker logged 15 "no longer owned … discarded" | PASS |
| API SIGKILL with jobs queued/running | worker independent | both jobs `succeeded` while the API was down; read back after restart | PASS |
| Logs | no transcript, secrets or signed URLs | grep of all drill logs: none | PASS |

## 4. Rollback drills

**Model/voice rollback** (`scratchpad/i04/model-rollback.mjs`; manifests with
a v2 `e2e-tone-2026.11.0` and the previous `e2e-tone-2026.10.0` for `vi`, same
file for API and worker):

| Step | Observed |
|---|---|
| Canary v2 enabled | job stamped `e2e-tone-2026.11.0` → `succeeded` |
| v2 job queued when the rollback starts | after restart on the rollback manifest: `failed TTS_MODEL_UNAVAILABLE` (fail fast, not stuck) |
| Re-create on that narration | NEW job id, `e2e-tone-2026.10.0` → `succeeded` |
| Re-create on a narration holding v2 audio | NEW job id (key includes `modelVersion`), draft audio regenerated under v1 with v1 provenance |
| Published audio | unchanged (sha list identical before/after) |
| Roll forward to v2 again | same row as the first v2 job is re-queued (its audio was replaced) → `succeeded`; a repeat create returns it idempotently (no new run) |

**Feature flags**: `TTS_GENERATION_ENABLED` (§3, both processes, restart
only); `SEARCH_HYBRID_ENABLED` true/false → identical rankings on all 50
queries (no embedder), no errors; `NEXT_PUBLIC_TTS_GENERATION_MODE` is
build-time and fails closed (unit tests: unset/empty/`API`/`off` → `off`;
browser smokes in `api`/`demo` builds at I03) — not re-run as a browser drill
here; prefer the backend kill switch (no rebuild).

**Migration 012 down/up with worker compatibility** (`scratchpad/i04/mig012.mjs`,
pre-I02 API = commit `61ceae5` built in a separate worktree on `:3301`):

| Schema | I02+ API | I02+ worker | pre-I02 API |
|---|---|---|---|
| 012 (current) | OK | OK | OK (login, admin list, public, create draft/job) |
| 011 (012 down) | admin narration list **500**, public narration **500**, create draft 500 | claim fails `42703` every tick (no crash, no writes) | OK |
| 012 re-applied | recovers without restart | recovers without restart; claims the job the old API queued → `TTS_MODEL_UNAVAILABLE` (old API stamps `TTS_DEFAULT_*`) | OK |

Exact order (also in `backend-ai-operations.md`): roll back = kill switch off
+ stop the I02+ worker → deploy the pre-I02 API → `012…down.sql` (+ delete its
`schema_migrations` row); roll forward = 012 up → I02+ API → worker. Down drops
`audio_generated_by` (AI provenance lost; audio kept). Pre-I02 has no worker
process at all. All local DBs that applied 012 carry `lease_token` (no drift
from the review edit of 012).

## 5. B03 — real S3-compatible storage

- Docker: the daemon was startable (`dockerd`), Docker Hub reachable
  (`hello-world` pulled), but `minio/minio` → "pull access denied" and
  `quay.io/minio/minio` → 403 through the proxy.
- **MinIO server built from source** with
  `go install github.com/minio/minio@v0.0.0-20260212201848-7aac2a2c5b7c`
  (official Go module proxy, checksums verified by `sum.golang.org`; binary
  reports `DEVELOPMENT.GOGET`, AGPLv3) — dev/test use only, not a release build.
- Integrity probe (`scratchpad/i04/s3-fidelity.mjs`), MinIO vs moto:

| Presigned PUT case | MinIO | moto |
|---|---|---|
| tampered body (same length) | 400 (checksum) | 200 |
| zeroed signature / wrong secret / other key / expired URL | 403 / 403 / 403 / 403 | 200 ×4 |
| signed `content-type` changed | 403 | 200 |
| valid PUT, HEAD sha256 + checksum match | 200, match | — |

- **Bug found:** the API presigner hoisted `x-amz-checksum-sha256` and
  `x-amz-meta-sha256` into the query string and left `content-type` unsigned,
  while clients send them as headers (`requiredHeaders`). MinIO answered
  "headers present in the request which were not signed" → **every editor
  audio upload would fail on real storage** (`smoke-media.mjs` PUT 400 before
  the fix). Fixed by signing those headers (`media-storage.ts`), regression
  test `apps/api/test/media-storage.test.ts`.
- On MinIO after the fix: `smoke-media.mjs` PASS; full TTS E2E (§1) PASS incl.
  submit HEAD verification and public signed GET; editor upload through
  `POST /v1/admin/media/presign` → PUT 200 (tampered retry 400) → submit 200 →
  approve → public GET sha256 match.
- Not covered: AWS S3 itself, TLS endpoints, the storage-restore drill, and a
  browser upload straight to the bucket (the editor-upload check above used
  Node `fetch`, which needs no CORS). The presigned URL carries no
  `x-amz-sdk-checksum-algorithm`/trailer, and `x-amz-checksum-sha256` is the
  base64 of the raw digest, which is what AWS S3 `PutObject` expects, but this
  was not run against AWS.
- **B03 verdict (review):** MITIGATED, not closed. The binary is a
  `DEVELOPMENT.GOGET` build fetched through the Go module proxy, not the
  "approved S3-compatible image" B03 asks for; only the coordinator can accept
  it as equivalent. Until then B03 and I04 stay open.

## 6. Issues raised by I03

a. **Public AI flag** — fixed, additive contract v1.2: `PoiNarration.audio.generatedBy?`
   (provider, model, modelVersion, voiceId, license, generatedAt; no job id),
   OpenAPI 0.1.2, shared types, API client, ADR 0014 amendment, tests. Live: a
   published AI narration carries it; editor uploads do not. Visitor UI label
   not changed (Tú).
b. **Search far below baseline** — not a bug in the release: the committed
   baseline is the Python OR-scoring runner, the API ANDs all tokens
   (`plainto_tsquery`) over name/descriptions only (T40 recorded 0.60). The
   live API scores **0.600 Recall@10 vs 0.911** for the committed T41 baseline
   (`baseline_report.json`, unchanged). The live-off run is recorded as an
   *additional* no-regression reference in `backend-hybrid-search.md`; the
   ADR 0012 gate (not below the T41 baseline) is unchanged and currently
   FAILS, so hybrid stays off. Re-basing the gate would need an ADR 0012
   amendment approved by the coordinator. Improving recall is a search
   follow-up.
c. **Disabled locale falls back silently** — by design; documented in
   `backend-narration-locales.md` (Disable a locale, step 4).
d. **(I03 review, High) md5-seeded narration ids rejected** — fixed:
   shape-only UUID pipe on every narration/TTS id route
   (`apps/api/src/common/uuid-shape.pipe.ts`), HTTP test with ids like
   `7a690593-2654-1ea1-4f71-…`; live: `latest`/`playback` on three seeded
   non-RFC ids → 200/404 instead of 400.

## 7. Open follow-ups

| ID | Severity | Item | Owner |
|---|---|---|---|
| F5 | Medium | The runner's per-attempt timeout does not stop the provider process (CLI SIGKILLs only its direct child); a timed-out attempt keeps running beside the retry, outside the quota. Pass an abort signal to providers; meanwhile keep manifest `timeoutMs` ≤ `TTS_JOB_TIMEOUT_MS` | Công **FIXED (L4): `TtsSynthesisRequest.signal` is aborted on timeout and Piper/CLI providers kill the whole process group (`apps/worker/src/tts/process-kill.ts`); test spawns a shell wrapper + grandchild and asserts the grandchild dies** |
| F6 | Low | DB outage answers `500 INTERNAL_ERROR`; map connection errors to `503` | Công **FIXED (L4): connection-level errors (ECONN*, SQLSTATE 08/57P0x/53300, pg “Connection terminated”) answer `503 SERVICE_UNAVAILABLE`; everything else stays 500 with a generic message** |
| F7 | Low | Worker config only checks stale window > attempt timeout; storage calls can take up to 120 s (re-claim mid-upload is fenced, but wasted) | Công **FIXED (L4): `loadTtsWorkerConfig` now requires `TTS_JOB_STALE_RUNNING_MS` > timeout + 3 storage calls (180 s) + longest backoff; fails fast at startup** |
| F8 | Info | After a worker crash, editors see `running` for up to 30 min (stale window) | Công/ops **ACCEPTED (L4): left as is — shortening the window raises the re-claim-while-running risk fixed by F7; operators see `running` ≤ `TTS_JOB_STALE_RUNNING_MS` after a worker crash. A heartbeat/lease would change semantics and needs an ADR** |
| F9 | Medium | Browser editor uploads go straight to the bucket with signed `content-type`/`x-amz-checksum-sha256`/`x-amz-meta-sha256` headers: the staging/production bucket needs a CORS rule allowing `PUT` from the admin origin with those headers (no CORS config exists in `infra/`). Run one browser upload + `smoke-media.mjs` against the real target store (AWS S3 or the approved image) at T60 | Công/platform |
| — | Blocker for I04 DONE | B03: coordinator approval of the MinIO dev-build evidence, or `smoke-media.mjs` on an approved image; GitHub CI green on the branch | coordinator/platform |
| — | Blocker for AI go-live | Real voice (Piper 403) + T06 blind review (I03 box 4), AI00 voice-consent/commercial-use ADR (drafted 2026-10-10 as ADR 0015 — Proposed, needs coordinator sign-off) | Công + Tú |
| — | Done 2026-10-10 | Storage-restore drill, metrics scrape endpoint, load test (ADR 0013 updated) | Công |
| — | Open | Lexical recall: L3 0.60 → 0.90, L4 direction intent → 0.956 (ADR 0012 gate passes, `backend-hybrid-search.md`). Still open: production embedding endpoint before enabling hybrid (2 synonym queries) | search/Công |
| — | Frontend | Show `audio.generatedBy` as "AI-generated" in visitor web; keep `NEXT_PUBLIC_TTS_GENERATION_MODE=off` until the AI NO-GO items close | Tú |

## 8. Reproduce

```bash
export PATH=/opt/node24/bin:$PATH
PGPASSWORD=… psql -h 127.0.0.1 -p 64321 -U damsen -d damsen -c 'CREATE DATABASE damsen_i04'
psql … -d damsen_i04 -f infra/docker/init-postgres.sql
DATABASE_URL=…/damsen_i04 npm run db:migrate
GOBIN=$PWD/bin go install github.com/minio/minio@v0.0.0-20260212201848-7aac2a2c5b7c
MINIO_ROOT_USER=damsen_local MINIO_ROOT_PASSWORD=damsen_local_password \
  bin/minio server <dir> --address 127.0.0.1:3391 &
npm run build
S3_ENDPOINT=http://127.0.0.1:3391 S3_BUCKET=damsen-media-b03 node scripts/smoke-media.mjs
# API :3300 + worker (env as backend-i02-integration-fixes.md §4, S3 → MinIO),
# then the scratchpad drivers: smoke.mjs main, drills.mjs <db|worker-kill|s3|
# provider|corrupt|killswitch|quota|races|api-restart>, model-rollback.mjs,
# mig012.mjs <probe-new|probe-old|down|up>, s3-fidelity.mjs, manual-upload.mjs
```

## 9. Closure run with a real network (2026-10-09, macOS arm64, Node 26)

Re-run of the items cloud could not do. Real: Postgres 16 (pgvector/pgRouting),
API + worker processes, **MinIO server**, **Piper voices** (vi/en/fr). Emulated:
none in this run.

| Item | Result |
|---|---|
| B03 object storage | `quay.io/minio/minio` and `minio/minio` are withdrawn upstream (401 / "repository does not exist"). `infra/docker/docker-compose.yml` now pins `bitnamilegacy/minio` by digest (last archived Bitnami MinIO build), with `MINIO_API_CORS_ALLOW_ORIGIN` for the admin/visitor origins. `npm run smoke:media` PASS; tampered body → 400, wrong `x-amz-checksum-sha256` → 403, valid PUT → 200. Not an upstream-official image: a production/staging bucket (AWS S3) is still T60. |
| F9 CORS | Preflight from `http://localhost:3001` allowed with the three signed headers; foreign origin gets no `Access-Control-Allow-Origin`. **Browser** upload from admin-web PASS (`apps/admin-web/scripts/audio-upload-browser-smoke.mjs`). It exposed a real bug: the default `fetch` in `NarrationAdminAdapter` was called unbound → `Illegal invocation` in every browser; fixed + regression test. |
| Real voice E2E | `scripts/e2e-tts-real-storage.mjs vi|en|fr`: login → draft → TTS job (`queued→running→succeeded`, worker process, Piper) → draft audio (sha + RIFF) → submit → approve → public narration with `audio.generatedBy` (no job id) → same bytes. PASS for all three locales. |
| Admin/visitor browser smokes (api mode, real Piper + MinIO) | admin narration + AI generation smoke PASS; visitor narration smoke PASS (vi/en/fr, AI label iff `generatedBy`). |
| Root gate (clean env) | format, lint, typecheck, test (all workspaces), build, geo/research/search-eval/tts-eval validators PASS; worker Postgres integration (6) PASS. GitHub CI (Node 24) green on PR #14: `quality` 3m15s, `fixture-contracts`. |

Voices (licenses read from each MODEL_CARD; `config/tts-voices.json`):
vi `vi_VN-vais1000-medium` CC-BY-4.0 (attribution required), en
`en_US-ljspeech-medium` public domain (chosen over `lessac`, whose Blizzard
licence is granted per registered licensee), fr `fr_FR-siwis-medium` CC-BY-4.0.
CC-BY attribution must ship with any public release (credits screen / docs).

Infra fixes found on the way: the Postgres image build failed because the base
image's pgdg suite moved to `apt-archive.postgresql.org` (Dockerfile fixed);
`postgis/postgis` has no arm64 image, so Apple-silicon needs Colima with Rosetta
(`colima start --vm-type vz --vz-rosetta`) and `DOCKER_DEFAULT_PLATFORM=linux/amd64`
for the Postgres build only.

Still **NO-GO** (unchanged): AI TTS go-live (no human blind rating, AI00
voice-consent/commercial-use ADR missing), hybrid enable (no embedding endpoint,
recall below baseline), public release (B01).

