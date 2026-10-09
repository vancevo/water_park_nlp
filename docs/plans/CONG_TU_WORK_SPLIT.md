# Phân chia Công / Tú — phát triển song song không chờ nhau

Mục tiêu của cách chia này là Công và Tú làm việc trên hai tập file tách biệt,
dựa trên một contract v1 được khóa trước khi code. Tú phát triển UI bằng mock;
Công phát triển backend/AI theo cùng contract. Chỉ bước tích hợp cuối cần output
của cả hai, nhưng không ai phải ngồi chờ trong giai đoạn implementation chính.

Tài liệu liên quan:

- `CONFIGURABLE_MULTILINGUAL_NARRATION_PLAN.md`
- `AI_TTS_AND_TRAINING_ROADMAP.md`

## 1. Contract v1 khóa trước khi bắt đầu

Hai bên không tự đổi shape dưới đây. Công là owner của OpenAPI/shared types thực
tế; Tú dùng local UI ports và fixtures có cùng shape cho đến ngày tích hợp.

```ts
type NarrationLocaleCode = string;

interface NarrationLocaleOption {
  code: NarrationLocaleCode;
  nativeLabel: string;
  speechTag: string;
  fallbackLocale?: NarrationLocaleCode;
}

interface NarrationLocaleCatalog {
  defaultLocale: NarrationLocaleCode;
  locales: NarrationLocaleOption[];
}

type TtsJobStatus =
  | 'queued'
  | 'running'
  | 'succeeded'
  | 'failed'
  | 'cancelled';

interface TtsGenerationJob {
  id: string;
  narrationId: string;
  status: TtsJobStatus;
  provider: string;
  model: string;
  modelVersion: string;
  createdAt: string;
  updatedAt: string;
  errorCode?: string;
}
```

Endpoint contract dự kiến:

```text
GET  /v1/narration-locales
POST /v1/admin/narrations/:narrationId/tts-jobs
GET  /v1/admin/tts-jobs/:jobId
POST /v1/admin/tts-jobs/:jobId/cancel
```

Quy tắc contract:

- `GET /v1/narration-locales` chỉ trả locale enabled và đúng thứ tự config.
- Create job trả `202` và `TtsGenerationJob` trạng thái `queued`.
- Polling trả một trong năm trạng thái đã khóa ở trên.
- Job thành công chỉ gắn audio vào draft narration, không tự publish.
- Error chỉ trả `errorCode` ổn định; không trả stack, transcript hoặc provider key.
- Nếu cần đổi contract, ghi proposal; không đổi trong code cho đến checkpoint
  tích hợp.

## 2. Phần Công — toàn bộ backend, AI và contract

Công có thể bắt đầu ngay, không cần UI của Tú.

### Checklist Công

- [ ] **C01 — Governance và backend contract** (contract v1→v1.2 xong; còn thiếu ADR AI00 về voice consent/commercial-use — I04 §1)
  - Hoàn thành AI00 ADR: AI-generated label, license, voice consent, review gate.
  - Hiện thực contract v1 trong OpenAPI, shared types và API client.
- [x] **C02 — Locale config và database** (I01/I03 PASS trên API thật; I04 §1)
  - Thực hiện phần backend của T25A/T25B.
  - Config parser, `GET /v1/narration-locales`, migration locale động, fallback,
    validation và media object-key safety.
- [x] **C03 — TTS worker foundation** (I02 consumer + DB int tests; drills I04 §3)
  - Thực hiện AI02: `TtsProvider`, job persistence, idempotency,
    retry/dead-letter, artifact/model registry và audio validation.
- [ ] **C04 — Piper baseline** (code + test mock; chưa từng sinh audio thật — voice Piper 403)
  - Thực hiện AI03 bằng corpus fixture nhỏ riêng của backend.
  - Pin model/voice/license/checksum; sinh audio và gắn vào draft narration.
- [ ] **C05 — Provider benchmark và training decision** (harness xong; corpus đầy đủ chỉ chạy provider giả, chưa blind review)
  - Thực hiện AI05 với fixture trước; chạy lại bộ corpus đầy đủ của Tú khi tích hợp.
  - AI06 chỉ mở sau quyết định GO; không train từ đầu.
- [ ] **C06 — Semantic search production** (flag/fallback chạy; chưa có embedding endpoint production — I04 §6b)
  - Thực hiện AI07: embedding provider, vector retrieval, hybrid ranking,
    feature flag và lexical fallback.
- [ ] **C07 — Backend/infra hardening** (drills + rollback xong I04 §3–4; chưa tick: metrics scrape endpoint và storage-restore drill còn mở)
  - Phần Công của AI08: queue/model metrics, quota, dead-letter, retention,
    failure drills và rollback.

### File ownership của Công

```text
packages/config/**
packages/shared-types/**
packages/api-client/**
apps/api/openapi.yaml
apps/api/src/**
apps/api/test/**
apps/worker/**
infra/**
config/**
docs/adr/**
docs/runbooks/backend-*.md
```

Công không sửa `apps/admin-web/**`, `apps/visitor-web/**`, `apps/mobile/**` hoặc
`data/tts-evaluation/**`.

## 3. Phần Tú — toàn bộ UI, UX và evaluation data

Tú có thể bắt đầu ngay bằng local ports/fixtures theo contract v1, không cần chờ
API, worker hoặc model chạy thật.

### Checklist Tú

- [x] **T01 — Mock ports và fixtures**
  - Tạo app-local `NarrationLocaleCatalogPort` và `TtsGenerationPort`.
  - Fixture có VI, EN, FR; job mô phỏng queued → running → succeeded/failed.
  - Không thêm type vào shared packages.
- [x] **T02 — Admin locale-aware UI**
  - Thực hiện T25C bằng mock catalog: selector động, history, upload theo locale,
    loading/error/empty/disabled states.
- [x] **T03 — Visitor narration selector**
  - Thực hiện T25D: locale narration độc lập với UI, local preference,
    fallback indicator, audio và Web Speech `speechTag`.
- [x] **T04 — Admin AI generation UX**
  - Phần UI của AI04: nút tạo audio, trạng thái, polling giả lập, cancel/retry,
    preview, provenance và cảnh báo “AI-generated”.
  - RBAC backend do Công làm; Tú test visibility/action guards ở UI.
- [x] **T05 — Mobile compatibility**
  - Thực hiện T25E ở client: narration locale là string BCP 47, không còn giả
    định transport chỉ có `vi|en`; không mở rộng mobile UI ngoài ADR 0006.
- [x] **T06 — Evaluation corpus và pronunciation assets**
  - Thực hiện AI01 độc lập: corpus VI/EN/FR, license manifest, tên POI, số/ngày,
    viết tắt, code-switch, pronunciation dictionary và report fixtures.
- [x] **T07 — Frontend quality gate**
  - Accessibility, keyboard/screen reader, responsive layout, browser tests,
    failure states và UI runbook.

### File ownership của Tú

```text
apps/admin-web/**
apps/visitor-web/**
apps/mobile/**
data/tts-evaluation/**
docs/product/tts-*.md
docs/runbooks/frontend-*.md
```

Tú không sửa OpenAPI, shared types, generated API client, API, worker, migration
hoặc infra. Trong giai đoạn song song, mock types phải nằm trong app tương ứng.

## 4. Công việc hoàn toàn độc lập

| Công | Tú | Lý do không chờ nhau |
|---|---|---|
| C01 contract/OpenAPI | T01 mock ports | Cùng dùng shape đã khóa trong tài liệu |
| C02 locale backend | T02 admin locale UI | Tú dùng catalog fixture VI/EN/FR |
| C03 worker/jobs | T04 generation UX | Tú mô phỏng toàn bộ job state machine |
| C04 Piper | T03 visitor selector | Visitor dùng audio URL fixture |
| C05 benchmark adapters | T06 evaluation corpus | Công chạy fixture nhỏ; corpus đầy đủ ghép cuối |
| C06 hybrid search | T05 mobile compatibility | Không chung module/file |
| C07 infra hardening | T07 frontend quality | Hai quality gate tách biệt |

T25C và T25D trước đây chờ T25B; trong cách chia mới chúng không chờ vì Tú dùng
mock catalog. AI04 UI trước đây chờ AI03; nay Tú dùng mock job lifecycle.

## 5. Bước tích hợp cuối — không phải giai đoạn chờ

Chỉ bắt đầu khi Công và Tú đều hoàn thành checklist riêng. Hai bên không cần giữ
thời gian rảnh trước checkpoint này.

### I01 — Adapter swap — Owner: Tú

- [x] Thay mock locale port bằng generated API client của Công.
- [x] Thay mock TTS job port bằng endpoints thật. (chế độ `api` chạy với AI04
  thật; mặc định flag vẫn `off` tới khi I02 xong)
- [x] Không đổi UI state machine nếu contract v1 được giữ đúng.
- [x] Giữ fixtures cho unit/component tests; chỉ E2E dùng backend thật. (E2E
  worker chạy qua harness claim ngoài repo + provider âm sine giả, vì worker
  chưa có consumer — xem `docs/runbooks/frontend-i01-integration-report.md` §5)

### I02 — Contract/integration fixes — Owner: Công

- [x] Sửa backend nếu response không đúng contract v1. (11/11 mục I01 — `docs/runbooks/backend-i02-integration-fixes.md`, ADR 0014)
- [x] Không yêu cầu Tú đổi UI để che lỗi contract backend. (v1 giữ nguyên; v1.1 chỉ thêm field/endpoint tuỳ chọn)
- [x] Chạy migration + API + worker + object storage smoke. (S3 emulator moto + provider CLI giả; MinIO/S3 thật vẫn là B03 → I04)

### I03 — End-to-end acceptance — Owner: Tú

- [x] Config thêm FR → admin/visitor tự xuất hiện.
- [x] Tạo transcript → generate → running → draft audio → review → publish.
  (worker thật; provider CLI âm sine giả + S3 emulator moto — Piper/B03 vẫn mở)
- [x] Visitor chọn locale, nghe đúng audio hoặc thấy fallback rõ ràng.
- [ ] Chạy corpus T06 qua provider được chọn và xuất benchmark cuối.
  (PARTIAL: 64 câu qua benchmark worker với provider giả, báo cáo
  `data/tts-evaluation/reports/fixtures/i03-pipeline-check-report.json` chỉ là
  kiểm tra pipeline; cần provider thật + blind review)
- [x] Hybrid search feature flag on/off đều hoạt động. (embedder giả để kiểm
  đường pgvector; xem báo cáo về chênh lệch baseline)

Báo cáo: `docs/runbooks/frontend-i03-acceptance-report.md`.

### I04 — Release gate — Owner: Công

- [x] Tổng hợp backend/frontend evidence. (`docs/runbooks/backend-i04-release-gate.md` §0–1)
- [x] Fault injection và rollback model/feature flag. (§3–4: 20 drills, model/flag/migration 012)
- [ ] Chỉ đánh dấu DONE khi B03/object storage thật và root quality gate pass. (CHƯA đạt: gate chỉ PASS local, CI chưa chạy; B03 mới MITIGATED bằng bản MinIO dev build tự compile — cần coordinator duyệt hoặc chạy lại trên image được duyệt, §2/§5)

## 6. Lịch song song đề xuất

```text
LUỒNG CÔNG                         LUỒNG TÚ
C01 contract/ADR                  T01 mock ports
C02 locale backend               T02 admin locale UI
C03 worker foundation            T03 visitor locale UI
C04 Piper                        T04 AI generation UX
C05 provider benchmark           T05 mobile compatibility
C06 semantic search              T06 evaluation corpus
C07 backend hardening            T07 frontend quality
          \                       /
           I01 -> I02 -> I03 -> I04
```

Công có thể đổi thứ tự C02/C03 và Tú có thể đổi thứ tự T02–T06 miễn không vượt
file ownership. Không task nào trong hai luồng chính phụ thuộc output chưa hoàn
thành của người kia.

## 7. Quy tắc Git và chống conflict

- Mỗi người dùng branch/worktree riêng: đề xuất `codex/cong-ai-backend` và
  `codex/tu-narration-ui`.
- Không cherry-pick các commit đang sửa file ngoài ownership.
- Không commit generated model, dataset audio, checkpoint hoặc secret.
- Công publish OpenAPI/client chỉ khi C01/C02 contract tests pass.
- Tú không cần kéo generated client cho đến I01.
- Mỗi task handoff ghi command, pass/fail, artifact và risk theo `AGENTS.md`.
- Nếu contract buộc phải đổi, dừng thay đổi shape, ghi ADR/proposal và cập nhật
  cả mock contract lẫn OpenAPI trong một integration commit có một owner.

## 8. Giới hạn thực tế

Hai luồng có thể phát triển mà không chờ nhau, nhưng sản phẩm end-to-end không
thể phát hành trước khi tích hợp output của cả hai. Cách chia này loại bỏ thời
gian chờ trong implementation; nó không loại bỏ checkpoint tích hợp và nghiệm
thu cuối, vì đó là nơi xác nhận mock và backend thực sự tương thích.
