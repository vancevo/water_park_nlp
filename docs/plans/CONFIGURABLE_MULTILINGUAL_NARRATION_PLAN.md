# Kế hoạch thuyết minh đa ngôn ngữ cấu hình được

## 1. Mục tiêu và quyết định phạm vi

Cho phép thêm, tắt và sắp xếp ngôn ngữ thuyết minh bằng cấu hình mà không phải
sửa union TypeScript, DTO, regex, SQL constraint hoặc UI tabs. Tiếng Việt và
tiếng Anh hiện tại tiếp tục hoạt động trong suốt quá trình migration.

Phạm vi này chỉ mở rộng **ngôn ngữ thuyết minh**. Ngôn ngữ giao diện và nội dung
POI hiện vẫn là `vi | en`; chúng không bị mở rộng ngầm theo danh sách thuyết
minh. Visitor web là client phát hành chính theo ADR 0006. Mobile được giữ tương
thích contract nhưng không nằm trên critical path.

Không tự động dịch hoặc tạo giọng nói bằng AI trong task này. Transcript/audio
vẫn do editor cung cấp và reviewer duyệt. Provider dịch/TTS tự động, nếu cần,
phải là task riêng với kiểm soát chi phí, quyền nội dung và chất lượng.

## 2. Contract cấu hình đề xuất

API là nguồn sự thật runtime cho các client. API đọc một file JSON đã validate;
đường dẫn có thể override bằng `NARRATION_LOCALES_CONFIG_PATH`. File mặc định là
`config/narration-locales.json` và luôn có `vi`, `en` để tương thích ngược.

Ví dụ cấu hình:

```json
{
  "defaultLocale": "vi",
  "locales": [
    {
      "code": "vi",
      "nativeLabel": "Tiếng Việt",
      "speechTag": "vi-VN",
      "enabled": true,
      "fallbackLocale": null
    },
    {
      "code": "en",
      "nativeLabel": "English",
      "speechTag": "en-US",
      "enabled": true,
      "fallbackLocale": "vi"
    },
    {
      "code": "fr",
      "nativeLabel": "Français",
      "speechTag": "fr-FR",
      "enabled": true,
      "fallbackLocale": "en"
    }
  ]
}
```

Quy tắc:

- `code` là BCP 47 đã canonicalize, dài tối đa 35 ký tự và không trùng.
- `defaultLocale` phải enabled.
- `fallbackLocale` phải tồn tại, enabled, không trỏ vào chính nó và không tạo
  vòng lặp.
- Tắt locale không xóa transcript/audio đã lưu; chỉ ẩn khỏi public selector và
  chặn tạo bản mới cho đến khi bật lại.
- Thứ tự phần tử trong file là thứ tự hiển thị.
- Secret, URL audio hoặc nội dung transcript không nằm trong file cấu hình.

Public contract mới:

- `GET /v1/narration-locales` trả về cấu hình public đã normalize.
- `NarrationLocaleCode` là string BCP 47 riêng, không tái sử dụng
  `SupportedLocale` của UI/POI.
- `GET /v1/pois/:poiId/narration?locale=<code>` thử locale yêu cầu, rồi đi theo
  fallback chain. Response giữ `requestedLocale`, `resolvedLocale` và đặt
  `fallbackUsed` đúng thực tế.
- API admin và media upload chỉ nhận locale đang enabled.
- OpenAPI và `packages/api-client` được cập nhật/generate trong cùng task.

## 3. Migration và tương thích

Tạo migration mới, không sửa migration 006 đã tồn tại:

- đổi `poi_narrations.locale` từ `varchar(5)` sang `varchar(35)`;
- thay check `IN ('vi','en')` bằng kiểm tra hình thức BCP 47 tối thiểu;
- giữ nguyên unique key `(poi_id, locale, revision)` và các partial index;
- object key tiếp tục có dạng `poi/<poiId>/<locale>/<sha256>.<ext>`, nhưng locale
  phải được encode/validate an toàn thay vì regex chỉ nhận `vi|en`;
- down migration chỉ rollback nếu không tồn tại locale dài hơn 5 hoặc ngoài
  `vi/en`; nếu có thì fail rõ ràng để tránh mất dữ liệu.

Không backfill nội dung mới. Dữ liệu `vi/en` hiện tại giữ nguyên byte-for-byte.

## 4. Task packets

### T25A — ADR, cấu hình và shared contract

```text
Task ID: T25A
Goal: Định nghĩa nguồn cấu hình và contract locale thuyết minh động.
In scope: ADR; JSON schema/parser; config mặc định vi/en; public DTO; OpenAPI endpoint.
Out of scope: migration dữ liệu, admin UI, visitor selector, AI translation/TTS.
Dependencies completed: T03, T24–T25 contract hiện tại, ADR 0006.
Files/modules allowed: docs/adr/**, config/**, packages/config/**,
  packages/shared-types/**, packages/api-client/**, apps/api/openapi.yaml,
  apps/api/src/narration/**, .env.example.
Contracts consumed: RuntimeConfig, SupportedLocale hiện tại, PoiNarration.
Contracts produced: NarrationLocaleCode, NarrationLocaleConfig,
  GET /v1/narration-locales, NARRATION_LOCALES_CONFIG_PATH.
Required reading: AGENTS.md; docs/STATUS.md; docs/FEATURE_REGISTRY.md;
  ADR 0006; PROJECT_PLAN.md sections 6–8.
Acceptance checks: invalid/duplicate/cyclic config fails startup; default vi/en works;
  endpoint omits disabled locale and exposes no filesystem path.
Verification commands: npm run lint; npm run typecheck;
  npm test --workspace @damsen/config; npm test --workspace @damsen/api.
```

### T25B — Database, API narration và media

```text
Task ID: T25B
Goal: Lưu, đọc, fallback và upload narration theo locale cấu hình.
In scope: additive migration; repository/service validation; fallback chain;
  object-key safety; OpenAPI/client regeneration; HTTP/DB tests.
Out of scope: UI, automatic translation, generated TTS, destructive cleanup.
Dependencies completed: T25A.
Files/modules allowed: infra/migrations/**, apps/api/src/narration/**,
  apps/api/test/**, apps/api/openapi.yaml, packages/api-client/**,
  packages/shared-types/**.
Contracts consumed: NarrationLocaleConfig và endpoint từ T25A.
Contracts produced: dynamic narration locale read/write contract; deterministic fallback.
Required reading: migration 006; narration service/repositories/media service;
  ADR được tạo bởi T25A.
Acceptance checks: vi/en regression pass; locale mới lưu/phát được; disabled locale
  bị từ chối ở write boundary; fallback response đúng requested/resolved/fallbackUsed;
  rollback guard không làm mất dữ liệu.
Verification commands: API unit/HTTP tests; migration up/down/up trên PostGIS test DB;
  npm run typecheck --workspace @damsen/api; npm run build --workspace @damsen/api.
```

### T25C — Admin cấu hình-aware

```text
Task ID: T25C
Goal: Editor quản lý transcript/audio cho mọi locale enabled.
In scope: tải locale catalog; tab/select động; label native; lịch sử theo locale;
  upload object key theo locale; loading/error/empty states.
Out of scope: sửa file cấu hình từ admin; machine translation; TTS generation.
Dependencies completed: contract v1 trong `CONG_TU_WORK_SPLIT.md` để làm bằng mock;
  T25B chỉ cần hoàn thành trước integration I01.
Files/modules allowed: apps/admin-web/**.
Contracts consumed: GET /v1/narration-locales và admin narration/media APIs.
Contracts produced: none.
Required reading: narration-panel, narration-admin-client, narration-media,
  admin tests gần module.
Acceptance checks: thêm locale trong config làm locale xuất hiện không cần sửa UI;
  locale disabled biến mất sau reload; draft/review/publish độc lập theo locale;
  quyền và validation audio không suy giảm.
Verification commands: admin lint/typecheck/test/build.
```

### T25D — Visitor web selector và playback

```text
Task ID: T25D
Goal: Visitor chọn ngôn ngữ thuyết minh độc lập với ngôn ngữ giao diện.
In scope: tải locale catalog; selector accessible trong POI detail; ghi nhớ lựa chọn
  trong localStorage; fallback indicator; audio playback; Web Speech dùng speechTag.
Out of scope: mở rộng toàn bộ UI/POI translations; offline audio cache; native mobile UI.
Dependencies completed: contract v1 trong `CONG_TU_WORK_SPLIT.md` để làm bằng mock;
  T25B chỉ cần hoàn thành trước integration I01.
Files/modules allowed: apps/visitor-web/**, packages/api-client/** nếu contract generated cần sửa.
Contracts consumed: public locale catalog và narration response.
Contracts produced: none.
Required reading: ADR 0006; visitor-experience; session/storage helpers; narration tests.
Acceptance checks: locale mới xuất hiện từ API; chọn locale tải đúng narration;
  fallback được báo rõ; audio ưu tiên hơn browser TTS; thiếu voice không chặn transcript;
  keyboard/screen-reader sử dụng được.
Verification commands: visitor lint/typecheck/test/build; browser smoke VI/EN + một locale mới.
```

### T25E — Mobile compatibility và release hardening

```text
Task ID: T25E
Goal: Loại bỏ giả định vi|en khỏi narration client và hoàn tất release checks.
In scope: mobile narration model/client chấp nhận NarrationLocaleCode; contract tests;
  metrics/log không chứa transcript; documentation và operator runbook.
Out of scope: thêm màn hình mobile mới khi ADR 0006 còn hiệu lực; offline cache T50.
Dependencies completed: contract v1; có thể làm client compatibility độc lập;
  backend T25B chỉ cần trước integration I01.
Files/modules allowed: apps/mobile/src/features/poi/**, docs/**,
  packages/shared-types/**, packages/api-client/**.
Contracts consumed: T25A/T25B.
Contracts produced: backward-compatible mobile client contract.
Required reading: ADR 0006; mobile narration model/client; analytics privacy policy.
Acceptance checks: mobile tests không hard-code vi/en trong narration transport;
  full quality gate pass; runbook mô tả add/disable/rollback locale.
Verification commands: mobile typecheck/tests; root lint/typecheck/test/build;
  config change smoke với vi,en,fr.
```

## 5. Thứ tự thực hiện

Theo phân công song song, Công sở hữu config/database/API contract của T25A/T25B;
Tú sở hữu UI/mobile của T25C–T25E và phát triển bằng mock contract. Hai luồng chỉ
ghép tại integration gate trong `docs/plans/CONG_TU_WORK_SPLIT.md`.

```text
Công: T25A backend -> T25B backend -------\
Tú:   T25C + T25D + T25E bằng mocks -------+-> I01 adapter integration
```

T25C–T25E bắt đầu từ contract v1 đã khóa, không chờ T25B. Shared contract,
OpenAPI và API client chỉ do Công sở hữu; Tú giữ mock types trong từng app cho
đến I01.

## 6. Definition of Done

- Thêm một locale hợp lệ chỉ bằng cập nhật config và deploy lại, không sửa code,
  schema, DTO hoặc UI.
- VI/EN hiện tại không mất dữ liệu và hành vi cũ vẫn pass regression tests.
- Locale validation thống nhất tại config loader và API write boundaries.
- Visitor thấy rõ khi narration fallback sang ngôn ngữ khác.
- Audio/transcript giữ workflow draft/review/publish và metadata quyền sử dụng.
- OpenAPI, typed client, registry, status, ADR và runbook đồng bộ.
- Migration được chứng minh up/down/up; không có secret, PII hoặc transcript trong log.
- Root lint, typecheck, test và build đều pass trước khi đánh dấu `DONE`.

## 7. Rủi ro cần kiểm soát

- BCP 47 có nhiều dạng: dùng thư viện/runtime chuẩn để canonicalize, không tự viết
  parser đầy đủ.
- Browser/OS có thể không có voice tương ứng; transcript và audio thu sẵn vẫn là
  fallback chức năng, không giả định Web Speech luôn có giọng.
- Không cho phép disable locale làm mất bản published hoặc phá URL audio cũ.
- Cache locale catalog cần version/ETag ngắn; rollout config và API phải diễn ra
  trước client dựa vào locale mới.
- B03 vẫn chặn smoke object storage thật; không đánh dấu media end-to-end hoàn tất
  cho đến khi kiểm tra upload/playback trên S3-compatible storage chạy qua.
