# Runbook — Frontend narration locales và AI TTS UX (T01–T07)

Phạm vi: `apps/admin-web`, `apps/visitor-web`, `apps/mobile` (transport) và
`data/tts-evaluation`. Backend/config/locale catalog do Công vận hành, xem
`backend-narration-locales.md`, `backend-tts-worker.md`, `backend-tts-piper.md`.

## 1. Feature flags (build time, `NEXT_PUBLIC_*`)

| Biến | App | Giá trị | Mặc định | Tác dụng |
|---|---|---|---|---|
| `NEXT_PUBLIC_NARRATION_DATA_MODE` | admin | `api` \| `demo` | `api` | Catalog locale lấy từ `GET /v1/narration-locales` hoặc fixture VI/EN/FR |
| `NEXT_PUBLIC_NARRATION_DATA_MODE` | visitor | `api` \| `demo` | `api` | Catalog **và** narration công khai lấy từ API hoặc fixture (VI có audio tone, EN chỉ transcript, FR thiếu → fallback EN) |
| `NEXT_PUBLIC_TTS_GENERATION_MODE` | admin | `off` \| `demo` \| `api` | `off` | Ẩn hoặc bật khu "Audio AI"; `demo` mô phỏng job trên trình duyệt, `api` gọi endpoint AI04 thật (đã kiểm ở I01). Mặc định giữ `off` cho tới khi I02 xong — lý do: `frontend-i01-integration-report.md` §3 |

`demo`/`test` chỉ dùng cho demo/dev. Không bật `demo` trên môi trường phát hành:
job demo không tạo audio thật và audio nghe thử chỉ là âm báo tổng hợp (có nhãn).

## 2. Chạy demo cục bộ

```bash
export PATH=/opt/node24/bin:$PATH   # Node 24
# Admin: build riêng để không đụng dev server đang chạy ở :3001
cd apps/admin-web
NEXT_PUBLIC_NARRATION_DATA_MODE=demo NEXT_PUBLIC_TTS_GENERATION_MODE=demo npx next build
npx next start -p 3011
# Visitor
cd ../visitor-web
NEXT_PUBLIC_NARRATION_DATA_MODE=demo npm run build && npx next start -p 3012
```

Kịch bản demo admin: tab Français → editor mới, nút tạo audio bị khoá cho đến
khi lưu; tab Tiếng Việt → "Tạo phiên bản mới" → lưu → "Tạo audio AI" →
queued → running → succeeded (preview + nhãn AI-generated + provider/model/
version) → "Tạo lại" → "Huỷ" → "Thử lại". Fixture cho FR thất bại lần đầu với
`TTS_TIMEOUT` để thấy luồng retry (chỉ xem được khi API cho phép lưu bản FR).
Lưu ý: ở chế độ demo, bản nháp vẫn được lưu vào API thật; xoá bản nháp kiểm
thử sau khi xong (script smoke tự xoá bản có tiền tố `[smoke]`).

## 3. Kiểm tra chất lượng

```bash
npm run lint && npm run typecheck
npm run test --workspace @damsen/admin-web     # ports, fixture lifecycle, reducer, RBAC guard
npm run test --workspace @damsen/visitor-web   # catalog, preference storage, voice, fixture source
npm run test --workspace @damsen/mobile        # BCP 47 narration transport
python3 data/tts-evaluation/validate.py && python3 data/tts-evaluation/test_validate.py
```

Browser smoke (không chạy trong `npm test`; cần app đang chạy, Chromium và
`playwright-core` cài ngoài repo — không thêm dependency vào workspace).
`SMOKE_MODE=demo` (mặc định) cho bản build `demo`; `SMOKE_MODE=api` cho bản
build `api` với backend thật (tabs/select phải khớp `GET /v1/narration-locales`;
admin cần worker tiêu thụ hàng đợi TTS, `SMOKE_FAIL_MARKER` tuỳ chọn để thử
nhánh lỗi):

```bash
SMOKE_MODE=demo PLAYWRIGHT_CORE_PATH=/path/node_modules/playwright-core CHROMIUM_PATH=/path/chrome \
  node apps/visitor-web/scripts/narration-browser-smoke.mjs http://localhost:3012 http://localhost:3000
SMOKE_MODE=demo ADMIN_EMAIL=... ADMIN_PASSWORD=... PLAYWRIGHT_CORE_PATH=... CHROMIUM_PATH=... \
  node apps/admin-web/scripts/narration-browser-smoke.mjs http://localhost:3011 http://localhost:3000
```

Smoke kiểm tra: locale từ catalog, bàn phím (Arrow/Home/End trên tab admin,
Home trên select visitor), `aria-live` trạng thái job, nhãn AI-generated và
provenance, khoá lưu/gửi duyệt khi job đang chạy và tiếp tục theo dõi sau khi
đổi tab, cancel/retry, audio thu sẵn được ưu tiên hơn Web Speech (demo), lựa chọn được ghi nhớ sau reload, đổi ngôn ngữ giao
diện không đổi ngôn ngữ thuyết minh, localStorage bị chặn vẫn chạy, không cuộn
ngang ở 390 px.

## 4. Accessibility checklist

- Admin: tab locale theo WAI-ARIA (`role=tablist/tab/tabpanel`, roving
  tabindex, Arrow/Home/End), mỗi tab có `lang` và trạng thái bản mới nhất.
- Trạng thái job trong vùng `role=status aria-live=polite aria-atomic`; lỗi
  dùng `role=alert`; tiến trình là danh sách có `aria-current="step"`.
- Nút bị khoá có lý do hiển thị và liên kết `aria-describedby`.
- Visitor: `<label>` + `<select>` native; chỉ thông báo ngắn (đang tải,
  fallback) nằm trong live region, transcript không bị đọc lại; transcript và
  audio có `lang`/`aria-label`; nút đổi giao diện có `aria-pressed`.
- Focus ring hiển thị (`:focus-visible`) ở cả hai app.

## 5. Failure states và cách xử lý

| Triệu chứng | Nguyên nhân thường gặp | Xử lý |
|---|---|---|
| Admin: "Không tải được danh sách ngôn ngữ" | API/catalog lỗi | Bấm "Thử lại"; kiểm tra `GET /v1/narration-locales` |
| Admin: không có tab | Catalog rỗng | Kiểm tra config backend (luôn phải có vi/en) |
| Admin: "Có bản thuyết minh ở ngôn ngữ đang tắt" | Locale bị tắt trong config | Đúng thiết kế: dữ liệu giữ nguyên, không hiện cho khách |
| Admin: không thấy khu Audio AI | `NEXT_PUBLIC_TTS_GENERATION_MODE` = off, hoặc role không phải EDITOR/REVIEWER/ADMIN | Bật flag khi rebuild; RBAC backend vẫn quyết định |
| Admin: nút tạo audio bị khoá | Chưa lưu, transcript đang sửa, bản không ở draft/rejected, hoặc tài khoản chỉ có REVIEWER | Làm theo lý do hiển thị |
| Admin: "Lưu thuyết minh"/"Gửi duyệt" bị khoá, ghi chú "Đang tạo audio AI…" | Job TTS đang `queued`/`running` hoặc yêu cầu tạo/huỷ chưa trả về | Chờ job kết thúc hoặc bấm "Huỷ tạo audio" |
| Admin: "Mất kết nối…" + "Kiểm tra lại" | 3 lần polling lỗi liên tiếp | Kiểm tra API rồi bấm "Kiểm tra lại" |
| Admin: job đứng ở "Đang chờ xử lý", sau 2 phút có ghi chú "máy chủ có thể chưa chạy worker" | Không có worker tiêu thụ `tts_generation_jobs` (I02-1) | Huỷ job; chạy worker; tạm thời để flag `off` |
| Admin: "Tính năng tạo audio AI đang tạm tắt (kill switch)" | `TTS_GENERATION_ENABLED=false` (khi backend đã wiring, I02-4) | Đúng thiết kế; bật lại phía backend |
| Admin: "Đã vượt hạn mức…"/"quá nhiều job…" | Quota AI08 (429 / `rate_limited` / `concurrency_limited`) | Chờ rồi thử lại |
| Admin: "Đã tạo xong" nhưng ghi chú "chưa gắn audio AI vào bản nháp" | Backend chưa lưu/gắn audio do AI tạo (I02-3) | Đúng với backend hiện tại; không gửi duyệt như thể đã có audio |
| Admin: "Tạo lại audio AI" không tạo job mới | Cùng transcript + model version là idempotent ở backend | Sửa transcript, lưu, rồi tạo lại |
| Visitor: ghi chú dùng Tiếng Việt/English | Catalog lỗi, đang dùng catalog dự phòng | "Thử lại"; transcript vẫn dùng được |
| Visitor: "Thiết bị chưa có giọng đọc …" | OS/browser không có voice cho `speechTag` | Đúng thiết kế: không đọc bằng giọng sai ngôn ngữ; transcript vẫn hiện |
| Visitor: "Trình duyệt chặn tự phát audio" | Autoplay policy | Người dùng bấm nút phát |

## 6. Rollback

- Ẩn AI generation: rebuild admin với `NEXT_PUBLIC_TTS_GENERATION_MODE=off`.
- Quay về catalog cố định: không cần — nếu API lỗi, visitor tự dùng VI/EN dự
  phòng; admin hiển thị lỗi và không cho chọn locale lạ.
- Tắt một locale: sửa config backend (xem runbook backend); sau khi reload,
  locale biến mất khỏi admin tabs và visitor select, lựa chọn đã lưu của khách
  tự rơi về locale UI/default.
- Revert code: các commit T01–T07 chỉ chạm `apps/*` của Tú, `data/tts-evaluation`
  và tài liệu; không có migration hay thay đổi contract cần rollback.

## 7. Integration I01 (Tú)

Kết quả, đối chiếu contract, bằng chứng E2E và danh sách I02 cho Công:
[`frontend-i01-integration-report.md`](frontend-i01-integration-report.md).

1. Rebuild admin với `NEXT_PUBLIC_NARRATION_DATA_MODE=api` và
   `NEXT_PUBLIC_TTS_GENERATION_MODE=api`; visitor với `api`. API cần
   `TTS_DEFAULT_PROVIDER/MODEL/MODEL_VERSION` khớp voice của worker.
2. UI state machine không đổi (contract v1 giữ nguyên); unit test vẫn dùng
   fixture. Backend thật re-enqueue job `failed`/`cancelled` với **cùng id** —
   reducer đã có test cho trường hợp này.
3. Chạy hai browser smoke với `SMOKE_MODE=api` (mục 3) và giữ `SMOKE_MODE=demo`
   xanh.
4. Thêm locale không sửa `config/`: trỏ `NARRATION_LOCALES_CONFIG_PATH` (đường
   dẫn tuyệt đối) tới file config tạm có `fr` (fallback `en`), khởi động lại
   API, tải lại trang — tab admin và select visitor tự xuất hiện.
5. I03 chạy `validate.py --export-benchmark` cho benchmark của Công và lặp lại
   E2E sau khi I02 xong (worker thật, audio gắn vào bản nháp, Piper thật).
