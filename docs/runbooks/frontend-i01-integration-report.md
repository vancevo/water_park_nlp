# I01 — Adapter swap: báo cáo tích hợp (Tú)

Phạm vi: `apps/admin-web`, `apps/visitor-web` đối chiếu với backend thật đã
merge (C01–C07, AI04 `apps/api/src/narration/admin-tts-job.controller.ts`,
AI08). Runbook vận hành UI: `frontend-narration-locales-tts.md`. Ngày chạy:
2026-10-09, Node 24, Postgres local (11 migration), S3 tắt (B03).

## 1. Kết quả ngắn

| Hạng mục | Kết quả |
|---|---|
| Locale port → `DamSenApiClient.getNarrationLocales` | Đã là mặc định (`NEXT_PUBLIC_NARRATION_DATA_MODE=api`); admin tabs và visitor select khớp đúng catalog thật |
| TTS port → `createTtsJob`/`getTtsJob`/`cancelTtsJob` | Chạy thật ở `NEXT_PUBLIC_TTS_GENERATION_MODE=api`; shape job, 202/200, 5 trạng thái, cancel/retry khớp contract v1 |
| UI state machine | Không đổi reducer/sự kiện; thêm test cho retry giữ nguyên job id (hành vi backend thật) |
| Fixture | Giữ nguyên cho unit test và chế độ `demo`; chỉ smoke `SMOKE_MODE=api` dùng backend thật |
| Mặc định `NEXT_PUBLIC_TTS_GENERATION_MODE` | **Giữ `off`** — xem §3 |
| E2E thật | Browser (admin, `api`) → API thật → Postgres → mã worker thật (qua harness claim, provider giả) → `queued → running → succeeded/failed`, cancel, retry. **Dừng ở metadata artifact**: audio không được lưu/gắn vào bản nháp (§4 I02-1, I02-3) |
| FR qua config (bằng chứng cho I03 mục 1) | `NARRATION_LOCALES_CONFIG_PATH` trỏ file tạm thêm `fr` (fallback `en`) → admin có tab "Français · Chưa có", visitor select có `fr` và API trả `fr → en` với ghi chú fallback; không sửa `config/` |

## 2. Đối chiếu contract (frontend ↔ backend thật)

Kiểm bằng HTTP thật (`curl`/script) và browser:

| Trường hợp | Backend thật | Frontend |
|---|---|---|
| Create | `202` job `queued` | OK |
| Create trùng (cùng transcript + modelVersion) | `202` trả lại job cũ (kể cả `succeeded`) | OK; "Tạo lại" chỉ ra job mới khi transcript đã đổi và lưu |
| Retry sau `failed`/`cancelled` | `202`, **cùng `id`**, reset về `queued` | Reducer nhận lại cùng id (test mới) |
| Cancel `queued` | `200` `cancelled`; cancel lần 2 idempotent | OK |
| Locale khác locale narration | `400 TTS_JOB_LOCALE_MISMATCH` | Đã map câu tiếng Việt |
| Locale tắt | `400 NARRATION_LOCALE_DISABLED` | Đã map |
| Body thừa/locale sai định dạng | `400 BAD_REQUEST` (details nội bộ) | Câu chung, không lộ message server |
| Không token | `401` | Đã map |
| Narration/job không tồn tại | `404` | Đã map (kèm khả năng bị dọn theo retention) |
| Lỗi job | `errorCode` `TTS_PROVIDER_ERROR` (thấy thật), `TTS_TIMEOUT`, `TTS_AUDIO_INVALID` | Đã map; thêm `AI_FEATURE_DISABLED` |
| Quota/kill switch AI08 | **Không có ở API** (chưa wiring; API không trả 429 ở đâu cả) | Map sẵn `rate_limited`, `concurrency_limited`, `AI_FEATURE_DISABLED`, HTTP 429/503 — **dự phòng, chưa kiểm được với backend**. Lưu ý: nếu `AiFeatureDisabledError` bị ném trong lúc tổng hợp, `errorCodeOf` của worker chỉ giữ mã `TTS_*` nên job sẽ mang `TTS_PROVIDER_ERROR`, không phải `AI_FEATURE_DISABLED` (`apps/worker/src/tts/tts-generation-service.ts:275-287`) |

Sửa phía frontend trong I01:

- `ttsRequestErrorMessage` map theo `code` trước rồi mới theo HTTP status; lỗi
  mạng (`TypeError: Failed to fetch`) không còn hiện tiếng Anh.
- Trạng thái `succeeded` không còn khẳng định "audio được gắn vào bản nháp"
  (sai với backend thật). Panel nói rõ bản nháp đã/chưa có audio khi không có
  URL nghe thử.
- Ghi chú khi job `queued` quá 2 phút (không có worker tiêu thụ hàng đợi).
- Browser smoke hai app có `SMOKE_MODE=api`.
- Review I01: lỗi `SyntaxError` (trang lỗi HTML không phải JSON) cũng hiện câu
  chung; ghi chú "chờ quá 2 phút" tính theo đồng hồ trình duyệt từ lúc thấy job
  `queued` (không phụ thuộc lệch giờ server) và nằm trong vùng `role=status`
  để trình đọc màn hình đọc được (kiểm bằng Playwright với đồng hồ giả).

## 3. Quyết định mặc định

`NEXT_PUBLIC_NARRATION_DATA_MODE` giữ `api` (đã là mặc định, endpoint ổn định).

`NEXT_PUBLIC_TTS_GENERATION_MODE` **giữ `off`** cho production. RBAC backend
có thật (create/cancel: EDITOR/ADMIN), nhưng chưa an toàn để bật mặc định:

1. Không có worker tiêu thụ `tts_generation_jobs` (I02-1) → job sẽ `queued` mãi.
2. Kill switch `TTS_GENERATION_ENABLED` và `QuotaGuard` chưa được gọi ở đâu
   (I02-4) → không có đường tắt/giới hạn khi sự cố.
3. Kết quả không thành audio của bản nháp (I02-3) → editor không có gì để nghe
   hay gửi duyệt.

Bật `api` theo môi trường (staging) bằng cách rebuild admin với flag; quay lui
bằng `off`. Đề xuất đổi mặc định sau khi I02-1/3/4 xong và I03 chạy lại.

## 4. Danh sách I02 cho Công (không sửa backend trong I01)

| ID | Mức | Vấn đề | Bằng chứng |
|---|---|---|---|
| I02-1 | Chặn | Worker không có consumer hàng đợi; `generate()` trả nguyên job `queued` do API ghi nên không thể chạy job của API | `apps/worker/src/main.ts:156-160` (`startWorker` chỉ log); `apps/worker/src/tts/tts-generation-service.ts:117` (`existing && !isRetryable` → return); `docs/runbooks/backend-tts-jobs.md:60` |
| I02-2 | Cao | Huỷ khi đang `running` bị ghi đè: worker không đọc lại trạng thái trước khi lưu kết quả → `cancelled → succeeded` (đã tái hiện thật) | `apps/worker/src/tts/tts-generation-service.ts:156-159`, `:163-165` |
| I02-3 | Chặn (cho audio) | Audio tổng hợp chỉ thành metadata (`audioSha256`, size, duration) trong `artifact`; byte audio bị bỏ, không upload object storage, không gắn vào `poi_narrations.audio_*`; job công khai không có artifact/URL | `apps/worker/src/tts/tts-generation-service.ts:237` (`buildArtifact`); `apps/api/src/narration/tts-job.service.ts:152-164` (`toPublic`); OpenAPI `TtsGenerationJob` `apps/api/openapi.yaml:882-904` |
| I02-4 | Cao | Kill switch và quota AI08 không được wiring ở worker lẫn API; runbook nói ngược lại | `apps/worker/src/ops/ai-feature-flags.ts:28` chỉ được export (`apps/worker/src/main.ts:151`), không có lời gọi; `apps/api/src/narration/tts-job.service.ts:54` không kiểm; `docs/runbooks/backend-ai-operations.md:27` |
| I02-5 | Trung bình | Create không kiểm trạng thái workflow; OpenAPI ghi "for a draft narration" nhưng narration `pending_review` vẫn nhận `202` (đã thử thật) | `apps/api/src/narration/tts-job.service.ts:54-77`; `apps/api/openapi.yaml:507` |
| I02-6 | Trung bình | Submit không bị chặn khi narration còn job `queued`/`running` (đã thử thật: submit `200` khi job `queued`) — UI chặn được trong phiên trang nhưng server mới là nguồn quyết định | `apps/api/src/narration/narration.service.ts:164-167` |
| I02-7 | Trung bình | OpenAPI chỉ khai báo `202`/`200` cho 3 endpoint TTS; thiếu `400` (+ mã `NARRATION_LOCALE_DISABLED`, `TTS_JOB_LOCALE_MISMATCH`, `TTS_JOB_TRANSCRIPT_EMPTY`), `401`, `403`, `404` | `apps/api/openapi.yaml:519-556` |
| I02-8 | Trung bình | `TTS_DEFAULT_PROVIDER/MODEL/MODEL_VERSION` không có trong `.env.example`; fallback `modelVersion: '0'` không khớp voice nào của worker → khoá idempotency API ≠ worker | `apps/api/src/narration/tts-job.models.ts:63-82`; `.env.example` (không có biến `TTS_*`) |
| I02-9 | Thấp | `ParseUUIDPipe({ version: '4' })` từ chối id narration seed (không phải v4) với `400 "uuid v 4 is expected"` | `apps/api/src/narration/admin-tts-job.controller.ts:43,53,62` |
| I02-10 | Thấp | Job `running` có thể mang `errorCode` của lần thử trước (worker lưu mã lỗi giữa các lần retry, API trả nguyên) | `apps/worker/src/tts/tts-generation-service.ts:163-165`; `apps/api/src/narration/tts-job.service.ts:162` |
| I02-11 | Thông tin | Khoảng trống contract cũ vẫn mở: không `playbackUrl` cho audio AI, không provenance trên narration, không endpoint job gần nhất của narration | `docs/product/tts-admin-generation-ux.md` (mục khoảng trống) |

## 5. Bằng chứng E2E

Dịch vụ: API `npm run dev:api` (S3 tắt, `TTS_DEFAULT_PROVIDER=e2e-tone`,
`TTS_DEFAULT_MODEL=ffmpeg-sine`, `TTS_DEFAULT_MODEL_VERSION=e2e-tone-2026.10.0`),
admin/visitor `next build` + `next start` ở `api`.

Worker: vì I02-1, một harness ngoài repo (scratchpad của phiên I01, **không
commit**, không thể tái hiện chỉ từ repo) bổ sung vòng "claim":
`UPDATE … SET status='running' WHERE status='queued'` nguyên tử, rồi gọi
**`TtsGenerationService.generate()` thật** với `PostgresTtsJobRepository`,
`TtsModelRegistry`, `CliTtsProvider` (mã worker thật) trên bảng thật. Để
`generate()` không trả nguyên hàng đã claim (`tts-generation-service.ts:117`),
harness **bọc `findByIdempotencyKey`** để hàng đang được nó xử lý hiện ra như
`failed`/chưa dead-letter (retryable); harness cũng tự gọi
`assertTtsGenerationEnabled()` mỗi vòng — tức kill switch chỉ có hiệu lực trong
harness, không phải trong worker thật (I02-4). Đây là bằng chứng cho đường
API ↔ UI và mã domain worker, **không** phải bằng chứng một worker sản xuất
chạy được. Provider là **CLI giả** (`ffmpeg` sinh âm sine 2 s, chờ
5 s; transcript chứa `[fail]` thì thoát lỗi) — không phải giọng đọc. Piper:
engine tải được từ PyPI nhưng voice trên HuggingFace bị chặn (`403` proxy),
nên không chạy được Piper thật ở môi trường này.

Admin smoke `SMOKE_MODE=api SMOKE_FAIL_MARKER='[fail]'` (PASS), job log rút gọn:

```text
POST 202 fe6aad90 queued → GET queued → GET running → GET succeeded
POST 202 e7f98db0 queued → POST(cancel) 200 cancelled → POST 202 e7f98db0 queued (retry, cùng id) → running → succeeded
POST 202 f6e91d54 queued → running → failed (TTS_PROVIDER_ERROR, attempts=3, dead_lettered)
```

Sau `succeeded`: narration vẫn `draft`, `audio: null` (không tự xuất bản, cũng
không có audio gắn vào); panel hiện "chưa gắn audio AI vào bản nháp này".
Cancel khi `running` qua API: `queued → running → cancelled → succeeded` (I02-2).

FR (config tạm, không sửa `config/`): tabs admin
`Tiếng Việt · English · Français (Chưa có)`; tạo bản nháp FR → job `fr` →
`succeeded`; visitor smoke `api: vi, en, fr` PASS, `fr` hiển thị transcript EN
kèm ghi chú fallback đúng như `GET /v1/pois/:id/narration?locale=fr`
(`resolvedLocale: en`).

## 6. Tái hiện

```bash
export PATH=/opt/node24/bin:$PATH
export $(grep -v '^#' .env.example | xargs) S3_ENABLED=false \
  ACCESS_TOKEN_SECRET=<32+ ký tự> REFRESH_TOKEN_SECRET=<32+ ký tự> \
  DEV_ADMIN_PASSWORD=<mật khẩu local> NARRATION_LOCALES_CONFIG_PATH=$PWD/config/narration-locales.json \
  TTS_DEFAULT_PROVIDER=<khớp worker> TTS_DEFAULT_MODEL=<khớp worker> TTS_DEFAULT_MODEL_VERSION=<khớp worker>
npm run dev:api &
# Worker: cần consumer thật (I02-1). Trước khi có, job dừng ở queued — UI báo sau 2 phút.
(cd apps/admin-web && NEXT_PUBLIC_NARRATION_DATA_MODE=api NEXT_PUBLIC_TTS_GENERATION_MODE=api npx next build && npx next start -p 3011) &
(cd apps/visitor-web && NEXT_PUBLIC_NARRATION_DATA_MODE=api npm run build && npx next start -p 3012) &
SMOKE_MODE=api PLAYWRIGHT_CORE_PATH=… CHROMIUM_PATH=… \
  node apps/visitor-web/scripts/narration-browser-smoke.mjs http://localhost:3012 http://localhost:3000
SMOKE_MODE=api ADMIN_EMAIL=… ADMIN_PASSWORD=… PLAYWRIGHT_CORE_PATH=… CHROMIUM_PATH=… \
  node apps/admin-web/scripts/narration-browser-smoke.mjs http://localhost:3011 http://localhost:3000
```

Smoke tự xoá bản nháp `[smoke]` (job bị xoá theo `ON DELETE CASCADE`).
