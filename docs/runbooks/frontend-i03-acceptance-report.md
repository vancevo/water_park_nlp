# I03 — End-to-end acceptance: báo cáo (Tú)

Phạm vi: định nghĩa I03 trong `docs/plans/CONG_TU_WORK_SPLIT.md` §5, chạy trên
nhánh `tu/i03-acceptance` (I02 `cong/i02-i04` + I01). Contract v1.1: ADR 0014.
Ngày chạy: 2026-10-09, Node 24. Runbook UI: `frontend-narration-locales-tts.md`;
backend: `backend-i02-integration-fixes.md`.

## 1. Kết quả theo checkbox I03

| # | Checkbox | Kết quả | Bằng chứng chính |
|---|---|---|---|
| 1 | Config thêm FR → admin/visitor tự xuất hiện | **PASS** | §3.1 — tabs `Tiếng Việt · English · Français (Chưa có)`, select `vi, en, fr`; bỏ FR khỏi config → tabs/select chỉ còn `vi, en`, admin báo "ngôn ngữ đang tắt (FR)" |
| 2 | Transcript → generate → running → draft audio → review → publish | **PASS** (provider giả, S3 emulator) | §3.2 — VI và FR: `queued → running → succeeded` bởi **worker thật**, reload → bản nháp có audio AI + provenance, nghe được qua playback URL (sha256 khớp), gửi duyệt → duyệt → `published` |
| 3 | Visitor chọn locale, nghe đúng audio hoặc thấy fallback | **PASS** (audio từ provider giả, phục vụ qua S3 emulator) | §3.3 — `fr`/`vi` phát đúng byte audio đã xuất bản (sha256 khớp, `currentTime` tăng); POI không có FR → "Chưa có thuyết minh Français; đang hiển thị bản English." |
| 4 | Chạy corpus T06 qua provider được chọn và xuất benchmark cuối | **PARTIAL — chỉ còn blind review của người** | Đã chạy toàn bộ 64 câu (vi 24 / en 21 / fr 19) qua **giọng Piper thật** trên CPU: 64/64 ok, p95 ≤ 0,95 s, RTF 0,19–0,24, automated checks sạch; report `data/tts-evaluation/reports/fixtures/i03-real-piper-report.json` (tái hiện: `data/tts-evaluation/run_real_voice_check.py`). Gate vẫn `missing-human-ratings` cho tới khi ≥ 3 người bản ngữ/locale chấm gói mù (`../tts-blind-review-pack/`). Đây là việc của con người, không đánh dấu PASS trước khi có điểm |
| 5 | Hybrid search flag on/off đều hoạt động | **PASS** (chỉ về chức năng; embedder giả) | §3.5 — off, on (không embedder), on (embedder sập), on (embedder giả + pgvector): đều trả kết quả, không lỗi, chỉ chế độ có embedder gắn lý do `semantic` (33/33 kết quả). **Không** chứng minh chất lượng: số liệu giống hệt ở cả bốn chế độ (Recall@10 0,600) và search sống thấp hơn nhiều so với baseline đã commit (Recall@10 0,600 vs 0,911; zero-result 0,46 vs 0,10) — chuyển Công/I04 (§5) |

I01 chuyển **DONE**: E2E thật giờ chạy qua tiến trình worker thật
(`node apps/worker/dist/worker.js`), không còn harness claim ngoài repo.

## 2. Môi trường

| Thành phần | Cấu hình |
|---|---|
| Postgres | DB riêng `damsen_i03` (postgis/vector/pgrouting như `infra/docker/init-postgres.sql`), migration 001–012 |
| API | `node apps/api/dist/main.js` trên `:3000` (dừng API I01 cũ theo PID), `S3_ENABLED=true` |
| Worker | `node apps/worker/dist/worker.js`, `TTS_WORKER_ENGINE=cli`, cùng `TTS_VOICES_MANIFEST_PATH` với API |
| Object storage | moto 5.1.4 (S3 emulator, dev-only) `:3290`, bucket `damsen-media-i03` |
| Provider TTS | CLI giả: `ffmpeg` sine 2 s, chờ 4 s, transcript chứa `[fail]` thì lỗi — **không phải giọng đọc**; voice `tone-vi/en/fr`, `e2e-tone/ffmpeg-sine@e2e-tone-2026.10.0` |
| Admin / Visitor | `next build` + `next start` `:3211` / `:3212`, rewrite `/api` → `:3000` (không cần route shim) |
| Locale config | `NARRATION_LOCALES_CONFIG_PATH` → file tạm ngoài repo thêm `fr` (fallback `en`); không sửa `config/` |

Script, log và ảnh chụp nằm trong scratchpad phiên (không commit):
`scratchpad/i03/{env.sh,e2e-i03.mjs,fr-off.mjs,controls.mjs,bench/,search/,shots/}`.

## 3. Bằng chứng

### 3.1 FR qua config (checkbox 1)

- Có FR: admin tabs `Tiếng Việt VI Đã xuất bản · English EN Đã xuất bản ·
  Français FR Chưa có` (`shots/01-admin-tabs-fr.png`); visitor select
  `["vi","en","fr"]`.
- Khởi động lại API với `config/narration-locales.json` (không FR): tabs chỉ
  còn VI/EN, admin hiện "Có bản thuyết minh ở ngôn ngữ đang tắt (FR)." (bản FR
  đã xuất bản được giữ), visitor select `["vi","en"]`
  (`shots/10-admin-fr-off.png`, `11-visitor-fr-off.png`). Không rebuild app.
- Yêu cầu `?locale=fr` khi FR tắt → `resolvedLocale: vi`, `fallbackUsed: true`.

### 3.2 Luồng đầy đủ trong trình duyệt (checkbox 2)

`e2e-i03.mjs` (Playwright, POI "Quảng Trường Mây"), cho từng locale `vi`, `fr`:

| Bước | VI | FR |
|---|---|---|
| Lưu bản nháp | revision 2 | revision 1 (locale mới từ config) |
| `Tạo audio AI` → `Đang chờ xử lý` → `Đang tạo audio` (Gửi duyệt bị khoá) → `Đã tạo xong` | ✓ (`02/03/04-vi-*.png`) | ✓ (`02/03/04-fr-*.png`) |
| Panel succeeded | "Audio AI đã được gắn vào bản nháp này (chưa xuất bản)…" — đúng vì `audioGeneratedBy.jobId` = job và sha256 khớp `artifact` | như VI |
| Reload trang | job `succeeded` khôi phục qua `GET …/tts-jobs/latest`; mục "Audio AI của phiên bản này" có nhãn AI-generated + nhà cung cấp/model/phiên bản/giọng/giấy phép/thời điểm; lịch sử phiên bản "AI-generated Audio AI · e2e-tone · ffmpeg-sine@e2e-tone-2026.10.0" (`05-vi-after-reload.png`) | ✓ (`05-fr-after-reload.png`) |
| Playback URL | `GET …/audio/playback` → 88 278 B, sha256 `bb325599f118…` = `audio.sha256`; trình duyệt giải mã được (duration 2 s) | 88 278 B, `5c89aad05c20…`, 2 s |
| Gửi duyệt → Duyệt xuất bản (admin có quyền REVIEWER) | `published` (`06/07-vi-*.png`) | `published` |

Job log (từ response trình duyệt) và chi tiết từng bước:
`scratchpad/i03/e2e-evidence.json`. Không có `pageerror`.

Browser smoke admin `SMOKE_MODE=api SMOKE_FAIL_MARKER='[fail]'` (PASS, bản
build `NEXT_PUBLIC_TTS_GENERATION_MODE=api`; lần chạy gốc dùng bản build mặc
định khi mặc định còn là `api`, chạy lại sau review — xem §4):

```text
GET(latest) 200 - none
POST 202 ffb133bf queued → GET running → GET succeeded       (playback sha256 khớp)
GET(latest) 200 ffb133bf succeeded                            (reload: kết quả + audio AI còn đó)
POST 202 2432cbd0 queued → GET(latest) queued                 (reload giữa chừng: tiếp tục theo dõi, Gửi duyệt khoá)
POST 200 2432cbd0 cancelled → POST 202 2432cbd0 queued → running → succeeded (retry cùng id)
POST 202 380d2103 queued → running → failed                   ("Dịch vụ giọng đọc AI gặp lỗi sau nhiều lần thử.")
```

Điều khiển AI08 như editor thấy (`controls.mjs`, PASS):

| Cấu hình API | Thông báo trong `role=alert` |
|---|---|
| `TTS_GENERATION_ENABLED=false` → 503 `AI_FEATURE_DISABLED` | "Tính năng tạo audio AI đang tạm tắt (kill switch). Thử lại sau hoặc liên hệ quản trị." (`shots/12-killswitch-503.png`) |
| `TTS_QUOTA_MAX_PER_WINDOW=1`, cửa sổ 10 phút → 429 `rate_limited` | "Đã vượt hạn mức tạo audio. Thử lại sau khoảng 10 phút." (`shots/13-quota-429.png`) |

Không lần nào hiện message tiếng Anh của server.

### 3.3 Visitor (checkbox 3)

- POI "Quảng Trường Mây": chọn `fr` → transcript `lang=fr`, không có ghi chú
  fallback, `<audio>` phát byte sha256 `5c89aad05c20…` (= bản FR đã xuất bản),
  `currentTime` 0,56 s sau 0,6 s phát (muted); `vi` → `bb325599f118…`
  (`08-visitor-{fr,vi}-audio.png`).
- POI "Sân Khấu Gió" (không có FR): chọn `fr` → "Chưa có thuyết minh
  Français; đang hiển thị bản English.", transcript `lang=en`, API
  `requested fr → resolved en, fallbackUsed true` (`09-visitor-fr-fallback.png`).
- Visitor smoke `SMOKE_MODE=api` PASS (`vi, en, fr`; kiểm byte audio đã xuất
  bản cho locale có audio).
- **Khoảng trống**: API công khai (`PoiNarration`) không có cờ "AI-generated",
  nên visitor chưa thể ghi chú audio do AI tạo. Không đổi API (xem §5).

### 3.4 Corpus T06 qua benchmark (checkbox 4 — PARTIAL)

```bash
python3 data/tts-evaluation/validate.py --export-benchmark <bench>/config/tts-benchmark-sentences.json  # 64 câu
cd <bench> && node /…/apps/worker/dist/tts/providers/run-provider-benchmark.js   # cwd riêng, không đụng config/
python3 -I <bench>/build-eval-report.py <bench> <repo> data/tts-evaluation/reports/fixtures/i03-pipeline-check-report.json
```

| Locale | ok/count | p50 | p95 | RTF | Gate (`thresholds.json` 1.0.0) |
|---|---|---|---|---|---|
| vi | 24/24 | 81 ms | 94 ms | 0,041 | fail: `missing-human-ratings` |
| en | 21/21 | 98 ms | 128 ms | 0,050 | fail: `missing-human-ratings` |
| fr | 19/19 | 88 ms | 105 ms | 0,045 | fail: `missing-human-ratings` |

- Provider: CLI âm sine (cùng adapter `CliTtsProvider` của worker), giữ bản
  WAV theo sha256 transcript để đo automated checks thật trên file
  (decodable, clipping, im lặng đầu/cuối/giữa) — số liệu mô tả **âm sine**,
  không phải giọng nói.
- Báo cáo cuối: `data/tts-evaluation/reports/fixtures/i03-pipeline-check-report.json`
  (`fixture: true`, ghi chú "PIPELINE CHECK, NOT A QUALITY BENCHMARK"), có
  trong manifest; `validate.py` PASS và hợp lệ theo `report.schema.json`
  (`jsonschema`). Không chứa transcript/audio.
- Còn thiếu để tick: provider thật (Piper/ZeroTTS…) chạy được + blind review
  người bản ngữ (ADR 0011). Recommendation tự động của harness ("e2e-tone")
  **không có giá trị quyết định**.

### 3.5 Hybrid search (checkbox 5)

50 câu `data/search-evaluation` qua `run_http_search.py` + `evaluate.py`, API
khởi động lại cho từng chế độ (embedding giả: trigram băm 1024 chiều, model
`i03-trigram-hash@2026.10.0`, 10 dòng `semantic_embeddings` cho 5 POI × vi/en —
chỉ kiểm đường pgvector + fusion, không có ngữ nghĩa):

| Chế độ | Recall@10 | MRR | nDCG@10 | Zero-result | Thứ hạng so với off | Lý do `semantic` |
|---|---|---|---|---|---|---|
| `SEARCH_HYBRID_ENABLED=false` | 0,600 | 0,600 | 0,600 | 0,46 | — | 0/33 |
| on, không `SEARCH_EMBEDDING_URL` | 0,600 | 0,600 | 0,600 | 0,46 | giống hệt | — |
| on, embedder không kết nối được | 0,600 | 0,600 | 0,600 | 0,46 | giống hệt (fail-closed) | — |
| on, embedder giả + pgvector | 0,600 | 0,600 | 0,600 | 0,46 | giống hệt | 33/33 |

Cả bốn chế độ trả kết quả, không lỗi; bật/tắt không cần đổi code. Thứ hạng
không đổi vì hybrid chỉ re-rank tập lexical và hầu hết truy vấn chỉ có 1 kết
quả với 5 POI. Quan sát cho Công ở §5 (chênh lệch so với baseline).

## 4. Thay đổi UI (contract v1.1)

- Nghe audio bản nháp qua `getAdminNarrationAudioPlayback` (component
  `NarrationAudioPreview`, URL ký 10 phút, lỗi/hết hạn → "Lấy lại đường dẫn"),
  nhãn AI-generated + provenance `audioGeneratedBy`, cả trong lịch sử phiên bản.
- Panel succeeded chỉ nói "đã gắn vào bản nháp" khi `audioGeneratedBy.jobId`
  và sha256 khớp job (`aiAudioAttachment`); nếu audio đã bị thay → nói rõ.
- Khôi phục job sau reload qua `getLatestTtsJob` (sự kiện reducer mới
  `job_restored`, không ghi đè yêu cầu đang chờ hay job khác); registry trong
  phiên vẫn giữ cho remount khi đổi tab.
- Mã lỗi mới: 409 `NARRATION_NOT_DRAFT`/`TTS_JOB_IN_PROGRESS`, 400
  `TTS_VOICE_UNAVAILABLE`, 503 `AI_FEATURE_DISABLED`, 429 kèm
  `retryAfterSeconds`; job `TTS_STORAGE_ERROR`, `TTS_MODEL_UNAVAILABLE`,
  `TTS_NARRATION_NOT_DRAFT`, `TTS_TRANSCRIPT_STALE`, `TTS_WORKER_LOST`,
  `TTS_PROVIDER_ERROR`. Lưu/gửi duyệt cũng map 409 liên quan AI.
- Guard: bản `rejected` phải lưu lại (về `draft`) trước khi tạo audio — khớp
  backend v1.1.
- Fixture demo: `artifact` trên job `succeeded` + `latest()`.
- **Mặc định `NEXT_PUBLIC_TTS_GENERATION_MODE` giữ `off`, fail closed**
  (thiếu/rỗng/giá trị lạ → `off`; chỉ `api`/`demo` tường minh mới hiện panel).
  Bản đầu của I03 đổi mặc định sang `api`; review đã hoàn lại vì:
  1. Chưa có voice production (Piper 403) và chưa có storage thật (B03). Kill
     switch backend `TTS_GENERATION_ENABLED` mặc định **bật**, API không có
     manifest vẫn nhận job với voice fallback mà không worker nào phục vụ →
     job fail `TTS_MODEL_UNAVAILABLE` (hoặc kẹt `queued` nếu chưa chạy worker).
     Một bản build mặc định `api` sẽ cho editor một nút chỉ có thể thất bại.
  2. Tắt kill switch thì an toàn (503 → câu tiếng Việt, kiểm ở §3.2) nhưng
     panel vẫn hiện với nút luôn lỗi — không phải trạng thái phát hành tốt.
  3. Cờ build-time: thiếu cấu hình nên được xử lý như giá trị lạ (fail closed),
     không phải bật tính năng.
  4. Quyết định bật cho production thuộc release gate I04 (Công), khi có voice
     thật + B03; I02 vẫn ở REVIEW.
  Staging/acceptance build với `NEXT_PUBLIC_TTS_GENERATION_MODE=api` (đã kiểm
  E2E ở đây). Khi bật: giữ `TTS_GENERATION_ENABLED=false` ở mọi môi trường chưa
  có voice thật; rollback = rebuild với `off` hoặc tắt kill switch backend.

## 5. Vấn đề cho Công (I04 follow-up)

| Mức | Vấn đề | Vị trí |
|---|---|---|
| Thông tin/gap | `PoiNarration` công khai không có cờ/provenance AI → visitor không thể ghi chú "AI-generated" (chỉ có chuỗi tự do trong `rightsSource`) | `apps/api/src/narration/narration.service.ts:46-91` (`published`); `packages/shared-types/src/index.ts:295-303` |
| Trung bình | Search sống (Postgres lexical) chênh lớn so với baseline đã commit: Recall@10 0,600 vs 0,911; zero-result 0,46 vs 0,10. 9/10 truy vấn `semantic_intent` và 9/9 `category_location` trả 0 kết quả. Vì hybrid chỉ re-rank tập lexical (ADR 0012), bật hybrid **không thể** cứu các truy vấn này; gate "không hồi quy so với baseline" của runbook cần so với baseline của API thật | `apps/api/src/search/search.service.ts:101-146`; `data/search-evaluation/baseline_report.json`; `docs/runbooks/backend-hybrid-search.md` §Preconditions 3 |
| Thông tin | Locale bị tắt (`?locale=fr` khi FR off) trả bản mặc định với `fallbackUsed: true` thay vì 400 — chấp nhận được, chỉ cần ghi trong runbook | `apps/api/src/narration/narration.service.ts:46-64` (`published`) |
| Cao | `ParseUUIDPipe()` mặc định từ chối một số id narration seed dạng md5 (bit variant không theo RFC 4122, ví dụ `7a690593-2654-1ea1-4f71-…`, `36f81b11-bca4-ac9d-…`) → 400 `Validation failed (uuid is expected)` trên `GET …/tts-jobs/latest` và `GET …/audio/playback` (đã thử trực tiếp trên API I03), và (theo code, chưa thử) cùng pipe ở PATCH/submit/approve/reject/delete. I02-9 chỉ bỏ ràng buộc version, chưa bỏ ràng buộc variant. E2E I03 không lộ ra vì chỉ dùng revision mới (UUID v4); log job của lần chạy E2E có `GET(latest) 400`. UI chỉ nuốt lỗi latest và hiện câu tiếng Việt cho playback | `apps/api/src/narration/admin-narration.controller.ts` (`new ParseUUIDPipe()` cho `:id`), `apps/api/src/narration/admin-tts-job.controller.ts:41` |
| Vẫn mở | B03 (MinIO/S3 thật) và voice thật (Piper 403) — I03 chạy trên moto + provider giả | `backend-i02-integration-fixes.md` §3 |

## 6. Tái hiện

```bash
export PATH=/opt/node24/bin:$PATH
PGPASSWORD=… psql -h 127.0.0.1 -p 64321 -U damsen -d damsen -c 'CREATE DATABASE damsen_i03'
psql … -d damsen_i03 -f infra/docker/init-postgres.sql
DATABASE_URL=…/damsen_i03 npm run db:migrate
moto_server -H 127.0.0.1 -p 3290 &          # dev-only S3 emulator
NEXT_PUBLIC_TTS_GENERATION_MODE=api npm run build   # mặc định off ẩn panel
# API (:3000) + worker: env như backend-i02-integration-fixes.md §4, thêm
#   NARRATION_LOCALES_CONFIG_PATH=<file tạm có fr> S3_ENDPOINT=http://127.0.0.1:3290
#   TTS_VOICES_MANIFEST_PATH=<manifest vi/en/fr> TTS_WORKER_ENGINE=cli
node apps/api/dist/main.js & node apps/worker/dist/worker.js &
(cd apps/admin-web && npx next start -p 3211) & (cd apps/visitor-web && npx next start -p 3212) &
SMOKE_MODE=api SMOKE_FAIL_MARKER='[fail]' ADMIN_EMAIL=… ADMIN_PASSWORD=… PLAYWRIGHT_CORE_PATH=… CHROMIUM_PATH=… \
  node apps/admin-web/scripts/narration-browser-smoke.mjs http://localhost:3211 http://localhost:3000
SMOKE_MODE=api PLAYWRIGHT_CORE_PATH=… CHROMIUM_PATH=… \
  node apps/visitor-web/scripts/narration-browser-smoke.mjs http://localhost:3212 http://localhost:3000
python3 data/search-evaluation/run_http_search.py --output /tmp/r.json && python3 data/search-evaluation/evaluate.py /tmp/r.json
```

Smoke api cần đọc được object storage từ tiến trình Node (băm byte của
playback URL). Bản build `demo` (cả hai flag `demo`) dùng `SMOKE_MODE=demo`.
