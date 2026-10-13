# Progress checklist — Operations, loyalty, payment và realtime map

- Plan nguồn: [OPERATIONS_LOYALTY_PAYMENT_REALTIME_MAP_PLAN.md](OPERATIONS_LOYALTY_PAYMENT_REALTIME_MAP_PLAN.md)
- Trạng thái chương trình: `BLOCKED` — local engineering complete; external staging/approval/pilot evidence required
- Progress tổng: `7/11 task DONE`; N07/N08 đang `REVIEW`, N09/N10 `BLOCKED`; toàn bộ technical/local preflight đã triển khai, external staging/approval/pilot vẫn mở
- Wave hiện tại: `Wave E — Hardening, staging gate và owner approval`
- Cập nhật lần cuối: 2026-10-13
- Người cập nhật: Codex

## 1. Cách sử dụng checklist

- Trạng thái task chỉ dùng: `TODO`, `READY`, `IN_PROGRESS`, `REVIEW`, `DONE`, `BLOCKED`.
- Chỉ đánh dấu `DONE` khi tất cả checkbox bắt buộc của task đã hoàn tất và có evidence.
- Mỗi task chuyển trạng thái phải cập nhật bảng tổng quan, `Updated`, owner và dòng evidence tương ứng.
- Không đánh dấu checkbox từ lời xác nhận miệng; cần link file, PR, test report hoặc command + kết quả.
- Nếu acceptance bắt buộc chưa chạy, task tối đa là `REVIEW` hoặc `PARTIAL`, không phải `DONE`.
- Khi contract/schema/public behavior thay đổi, phải có OpenAPI/shared type/ADR và contract test trong cùng task.
- Nếu task phát sinh ngoài scope, ghi vào backlog; không tự nới scope của task đang chạy.

## 2. Bảng tiến độ tổng quan

| Task | Nội dung | Depends on | Owner | Status | Progress | Evidence/Handoff |
|---|---|---|---|---|---:|---|
| N00 | Product rules, demo guard và privacy ADR | T10/T11, T51 | Codex | DONE | 100% | ADR 0016 |
| N01 | Shared contracts, migrations, module skeleton | N00 | Codex | DONE | 100% | migration 017 + OpenAPI/types/client |
| N02 | Demo phone account không OTP | N01 | Codex | DONE | 100% | multi-signal rate limit + audited masked lookup; HTTP/real DB pass |
| N03 | Loyalty ledger và reward redemption | N01 | Codex | DONE | 100% | audited/idempotent admin adjustment + transaction tests pass |
| N06 | Outbox và authenticated WebSocket | N01 | Codex | DONE | 100% | standalone worker → Redis → authenticated Socket.IO smoke pass |
| N04 | Payment order và QR simulator | N02, N03, N06 interface | Codex | DONE | 100% | success/failure/expiry + consumed-token + API-restart replay pass |
| N05 | Payment web app | N04, N06 | Codex | DONE | 100% | happy/failed/expired/offline/reconnect browser smoke pass |
| N07 | Presence và admin live map | N02, N06, N00 privacy ADR | Codex | REVIEW | 95% | local 1k socket/1k-marker browser pass; staging + privacy approval open |
| N08 | Operations dashboard | N04, N07, N00 glossary | Codex | REVIEW | 98% | recent-payment cursor feed, indexed queries, browser smoke, timezone/freshness/delayed tests pass; staging latency mở |
| N09 | Security, privacy, load và failure drills | N05, N07, N08 | Codex | BLOCKED | 90% | local engineering complete; HTTPS staging capacity artifact + privacy/security approval unavailable |
| N10 | Staged rollout và acceptance | N09 | Codex | BLOCKED | 50% | local acceptance/reset/training pack pass; staged pilot + owner approvals chưa có |

## 3. Gate trước khi bắt đầu

- [x] Coordinator xác nhận plan và phạm vi MVP.
- [x] Có owner duy nhất cho từng shared contract/migration tại một thời điểm.
- [x] Các thay đổi local hiện tại đã được commit hoặc phân định owner, tránh ghi đè.
- [x] Task bắt đầu có packet đầy đủ theo `AGENTS.md`.
- [x] Dependency của task ở trạng thái `DONE`.
- [x] Feature registry đã được kiểm tra trước khi tạo module/helper/schema mới.
- [x] Không có blocker công khai chưa được gán owner.

## 4. Wave A — Product, privacy và contract

### N00 — Product rules, demo guard và privacy ADR

Trạng thái: `DONE`
Owner: `Codex`
Started: `2026-10-11`
Updated: `2026-10-12`

#### Quyết định sản phẩm

- [x] Chốt định nghĩa `active visitors`, `paying users` và `online now`.
- [x] Chốt simulated revenue và phạm vi today/yesterday/week/month.
- [x] Chốt bucket đông/vắng, giờ mở cửa và cách xử lý bucket thiếu dữ liệu.
- [x] Chốt rule cộng điểm theo loại vé và versioning.
- [x] Chốt expiry của điểm nếu có.
- [x] Chốt fulfillment/cancel/return của quà đổi.
- [x] Chốt role matrix cho `CASHIER`, `OPERATIONS`, `ADMIN`.

#### Payment simulation và bảo mật

- [x] Chốt `DEMO_MODE` và production hard-disable.
- [x] Chốt banner `MÔ PHỎNG — KHÔNG PHẢI THANH TOÁN THẬT` trên mọi màn hình liên quan.
- [x] Chốt QR URL dùng opaque one-time token, không chứa PII/amount.
- [x] Chốt thời gian `pending -> processing -> succeeded` và cách kích hoạt failure/expiry để demo.
- [x] Chốt chỉ dùng synthetic/demo phone trong shared staging.
- [x] Chốt HMAC lookup + last4; không lưu phone raw/ciphertext nếu không cần khôi phục.

#### GPS/privacy

- [x] Viết ADR mới/amend ADR 0005 cho live presence.
- [x] Chốt consent copy, purpose, role được xem và thao tác rút consent.
- [x] Chốt Redis TTL cho raw location và retention cho session audit.
- [x] Chốt ngưỡng suppress zone aggregate để tránh suy ngược cá nhân.
- [x] Chốt capacity target staging và production candidate.

#### Gate N00

- [x] ADR/product contract được coordinator duyệt.
- [x] Metric glossary có boundary theo `Asia/Ho_Chi_Minh`.
- [x] Demo flow cashier → QR → scan → processing → succeeded được chốt ở contract; browser evidence thuộc N05.
- [x] Demo phone/payment hard-fail ngoài môi trường cho phép được chốt ở contract; code evidence thuộc N02/N04.
- [x] Không còn quyết định mở làm thay đổi public schema/API.
- [x] Evidence được ghi ở §10.

### N01 — Shared contracts, migrations và module skeleton

Trạng thái: `DONE`
Owner: `Codex`
Started: `2026-10-11`
Updated: `2026-10-11`

- [x] Kiểm tra migration mới nhất trước khi cấp số migration.
- [x] Viết OpenAPI/shared DTO additive cho identity, loyalty, payment, presence, reporting.
- [x] Định nghĩa event envelope có `eventId`, `schemaVersion`, `sequence`, `occurredAt`.
- [x] Thêm role `CASHIER` và `OPERATIONS` với migration tương thích.
- [x] Tạo schema demo phone identity theo ADR đã duyệt; không có OTP challenge.
- [x] Tạo schema ticket/payment order/one-time token/simulation event.
- [x] Tạo schema loyalty/rule/reward/redemption.
- [x] Tạo schema presence session, zone interval và domain outbox.
- [x] Thêm index, FK, check constraint và unique idempotency keys.
- [x] Có migration rollback hoặc forward-fix an toàn.
- [x] Tạo repository/module skeleton, chưa bật feature.
- [x] Thêm feature flags mặc định `off`.
- [x] Generate/update API client.
- [x] Cập nhật feature registry ở trạng thái `planned`/`in_progress`.

#### Gate N01

- [x] Migration `up/down/up` pass trên database sạch.
- [x] Email/password auth regression pass.
- [x] Contract tests pass.
- [x] `npm run lint` pass đúng phạm vi.
- [x] `npm run typecheck` pass đúng phạm vi.
- [x] Evidence được ghi ở §10.

## 5. Wave B — Identity, loyalty và realtime foundation

### N02 — Demo phone account không OTP

Trạng thái: `DONE`
Owner: `Codex`
Started: `2026-10-11`
Updated: `2026-10-12`

- [x] Chuẩn hóa số điện thoại về E.164 tại boundary.
- [x] Tra cứu bằng HMAC, không index phone raw.
- [x] Chỉ lưu phone hash + last4 và chỉ trả `phoneMasked`.
- [x] Demo phone session tạo/mở đúng account theo normalized phone.
- [x] UI nói rõ số điện thoại không được xác minh bằng OTP.
- [x] Endpoint hard-fail khi `DEMO_PHONE_AUTH_ENABLED` tắt hoặc môi trường production.
- [x] Rate limit theo phone hash, IP/session và device signal phù hợp.
- [x] Phone demo session phát hành access/refresh token hiện có.
- [x] Cùng normalized phone luôn mở cùng account, không tạo account lặp.
- [x] Admin/cashier lookup phone được audit và trả dữ liệu tối thiểu.
- [x] Không log phone raw hoặc access/refresh token.
- [x] Visitor profile/login UI hoàn chỉnh.

#### Gate N02

- [x] Unit/HTTP/real-DB tests pass.
- [x] Demo guard, same-phone, rate-limit và anti-enumeration tests pass.
- [x] Email login và refresh rotation regression pass.
- [x] Visitor lint/typecheck/build pass.
- [x] Evidence được ghi ở §10.

### N03 — Loyalty ledger và reward redemption

Trạng thái: `DONE`
Owner: `Codex`
Started: `2026-10-11`
Updated: `2026-10-12`

- [x] Loyalty account được tạo idempotent theo user.
- [x] Ledger entry immutable, có source và idempotency key.
- [x] Balance snapshot cập nhật cùng transaction với ledger.
- [x] Rule tích điểm có version/effective range.
- [x] Payment/order lưu snapshot rule được áp dụng.
- [x] Reward catalog có active range và cost snapshot.
- [x] Redemption khóa/version-check balance để chống double-spend.
- [x] Fulfillment code/status không thể đoán và được audit.
- [x] Admin adjustment yêu cầu actor/reason và tạo audit log.
- [x] API `/me/loyalty`, rewards và redemptions hoàn chỉnh.

#### Gate N03

- [x] Tổng ledger khớp balance snapshot.
- [x] Duplicate source không cộng/trừ hai lần.
- [x] Hai redemption đồng thời chỉ một request thành công.
- [x] Payment simulation success tạo đúng một credit ledger.
- [x] Contract/migration/transaction tests pass.
- [x] Evidence được ghi ở §10.

### N06 — Transactional outbox và authenticated WebSocket

Trạng thái: `DONE`
Owner: `Codex`
Started: `2026-10-11`
Updated: `2026-10-12`

- [x] Domain outbox được ghi cùng transaction nghiệp vụ.
- [x] Relay có retry, backoff, dead-letter và metric.
- [x] Event publish lặp không làm consumer xử lý nghiệp vụ lặp.
- [x] WebSocket handshake xác thực access token.
- [x] Room subscription kiểm tra resource ownership/RBAC.
- [x] Socket event validate schema/version/size.
- [x] Client reconnect gọi REST snapshot trước khi áp delta.
- [x] Redis adapter/config sẵn sàng cho nhiều API instance.
- [x] Payment/balance event đi room riêng; location delta được coalesce latest-per-session theo animation frame.
- [x] Redis lỗi không làm sai trạng thái trong Postgres.
- [x] Request/event correlation không chứa PII/raw GPS.

#### Gate N06

- [x] Event vẫn được relay sau API restart.
- [x] Unauthorized room tests pass.
- [x] Duplicate/out-of-order/reconnect tests pass.
- [x] Redis outage/recovery drill pass.
- [x] API + worker + Redis smoke pass.
- [x] Evidence được ghi ở §10.

### Gate Wave B

- [x] N02 `DONE`.
- [x] N03 `DONE`.
- [x] N06 `DONE`.
- [x] Shared contract chỉ có một owner và đã merge/generate đồng bộ.
- [x] Không có PII/secret/raw GPS trong test log.

## 6. Wave C — Payment vertical slice

### N04 — Payment order và QR simulator

Trạng thái: `DONE`
Owner: `Codex`
Started: `2026-10-11`
Updated: `2026-10-12`

- [x] Ticket product có server-side price và active state.
- [x] Client chỉ gửi product ID/quantity, không gửi authoritative price/points.
- [x] Order create có idempotency key và customer token ngắn hạn.
- [x] Order state machine chặn transition sai.
- [x] QR URL có opaque token đủ dài, lưu hash, single-use và có expiry.
- [x] QR/page summary không lộ phone, user ID hoặc authoritative point rule.
- [x] Demo page hiển thị banner không phải thanh toán thật.
- [x] Confirm có idempotency key; click/retry lặp trả kết quả idempotent.
- [x] Server tự chuyển `pending -> processing -> succeeded/failed/expired`.
- [x] Payment success + loyalty credit + outbox commit cùng transaction.
- [x] Failed/expired order không cộng điểm.
- [x] API restart giữa processing không tạo order/credit lặp; payment completion hiện thuộc API transaction, không có payment worker riêng.
- [x] Simulator hard-fail ngoài `DEMO_MODE`.
- [x] Không log raw QR token hoặc phone.

#### Gate N04

- [x] Cashier → QR → scan → processing → succeeded → points pass.
- [x] Tampered amount và invalid/expired/consumed token tests pass.
- [x] Duplicate confirm/restart replay pass.
- [x] Simulated failed/expired smoke pass.
- [x] Timezone/day-boundary tests pass.
- [x] Migration/API/contract tests pass.
- [x] Evidence được ghi ở §10.

### N05 — Payment web app

Trạng thái: `DONE`
Owner: `Codex`
Started: `2026-10-11`
Updated: `2026-10-12`

- [x] Tạo workspace `apps/payment-web` và root scripts cần thiết.
- [x] Chỉ `CASHIER`/`ADMIN` đăng nhập được.
- [x] Phone lookup chỉ hiển thị thông tin masked tối thiểu.
- [x] Ticket/quantity/summary lấy giá authoritative từ API.
- [x] Double-click submit chỉ tạo một order.
- [x] QR countdown và trạng thái pending rõ ràng.
- [x] Public `/demo-pay/:token` page chỉ hiện order summary đã redaction.
- [x] Nút “Thanh toán demo” chạy processing UI và không gọi dịch vụ bên ngoài.
- [x] Mọi màn hình liên quan có nhãn mô phỏng rõ ràng.
- [x] WebSocket cập nhật payment status; failed/expired đã có browser smoke.
- [x] Polling/REST fallback hoạt động khi mất socket.
- [x] Refresh/reconnect khôi phục order đang mở.
- [x] Success hiển thị order, amount và điểm đã cộng.
- [x] Visitor web nhận balance event rồi refresh REST; polling vẫn là fallback.
- [x] Retry/cancel không tạo trạng thái sai.
- [x] Cashier không truy cập được operations/live-location data.

#### Gate N05

- [x] Lint/typecheck/build pass.
- [x] Browser E2E phone → ticket → QR → confirmed pass.
- [x] Expired/failed/reconnect/offline smoke pass.
- [x] RBAC negative tests pass.
- [x] Evidence được ghi ở §10.

### Gate Wave C

- [x] N04 `DONE`.
- [x] N05 `DONE`.
- [x] Demo order, payment status và point balance khớp 100%.
- [x] Tắt WebSocket vẫn xem đúng order/balance bằng REST.

## 7. Wave D — Presence và operations dashboard

### N07 — Consent-based presence và admin live map

Trạng thái: `REVIEW`
Owner: `Codex`
Started: `2026-10-11`
Updated: `2026-10-12`

- [x] Consent UI nói rõ purpose, người xem, TTL và cách dừng.
- [x] User đã auth có marker Cổng 1 mô phỏng; chỉ vị trí thiết bị thật mới cần opt-in rõ ràng.
- [x] Chỉ gửi foreground, tối thiểu 5 giây và movement khoảng 10 m; heartbeat 20 giây.
- [x] GPS accuracy trên 100 m bị từ chối ở API boundary.
- [x] API validate timestamp, sequence, bounds và accuracy.
- [x] Redis chỉ giữ latest point với TTL.
- [x] Opt-out/revoke xóa latest point ngay.
- [x] Destination chỉ lấy từ route user chủ động chọn.
- [x] Pseudonym/avatar không suy ra thuộc tính nhạy cảm.
- [x] Admin realtime delta kích hoạt REST snapshot; polling reconnect vẫn hoạt động.
- [x] MapLibre dùng một GeoJSON source với circle layer/cluster, không tạo React marker mỗi user.
- [x] Payment thành công của đúng user mở consent prompt; realtime có loyalty REST polling fallback 2 giây.
- [x] User từ chối/GPS lỗi dùng nhân vật mô phỏng tại Cổng 1; nhiều user có pseudonym, màu và offset riêng.
- [x] Hai user đã đăng nhập thấy nhau trên cùng visitor map; marker của chính mình không bị vẽ trùng.
- [x] Visitor chỉ nhận pseudonym/avatar/location mode; không nhận user ID, phone, ticket state hoặc destination; GPS thật được làm mờ cố định 15 m.
- [x] Visitor map dùng một clustered GeoJSON source, gom delta theo animation frame, đối soát snapshot 15 giây và chỉ poll 5 giây khi realtime mất kết nối.
- [x] Các consumer trong cùng visitor tab dùng chung một WebSocket theo access token để tránh nhân số kết nối.
- [x] Chuyển động bằng controller và đi tự động được phát realtime sang visitor khác; tối đa một update/giây, ngưỡng 2 m, luôn gửi trailing latest point và không chạy request chồng nhau.
- [x] Lớp nearby-presence khởi tạo theo MapLibre `load`/`mapReady`, không bỏ lỡ snapshot khi style ảnh nền còn hoàn tất bất đồng bộ.
- [x] Zone aggregate không có user ID/raw coordinate và áp suppression threshold.
- [x] Không có raw lat/lng trace trong Postgres/log/analytics.

#### Gate N07

- [x] Start/update/snapshot/old-sequence/stop và Redis TTL automated tests pass.
- [x] Out-of-bounds/rate abuse tests pass.
- [x] Privacy log/database scan pass.
- [x] 1.000-marker browser smoke không freeze/crash.
- [ ] Staging gate 1.000 sockets/500 publishers/10 admin maps pass.
- [x] Evidence được ghi ở §10.

### N08 — Admin operations dashboard

Trạng thái: `REVIEW`
Owner: `Codex`
Started: `2026-10-11`
Updated: `2026-10-12`

- [x] Dashboard route chỉ cho `OPERATIONS`/`ADMIN` ở API boundary.
- [x] Summary hiển thị active, paying và online như ba metric riêng.
- [x] Revenue cards ghi rõ “doanh thu mô phỏng” và lấy tổng order demo `succeeded`.
- [x] Today/yesterday/week/month dùng `Asia/Ho_Chi_Minh`.
- [x] Traffic chart dùng bucket 15 phút và lọc bucket ngoài giờ hoạt động cấu hình theo giờ Việt Nam.
- [x] Peak/quiet không tính bucket thiếu dữ liệu.
- [x] Recent payment feed có keyset cursor/pagination và chỉ lộ phone đã che.
- [x] UI hiển thị `generatedAt`, timezone và freshness state.
- [x] Polling refresh/snapshot là nguồn dữ liệu hiện tại.
- [x] Empty/error state rõ ràng; partial/delayed có nhãn riêng và polling error không bị nuốt.
- [x] Query/rollup có index; local 100k-order plan dùng paid-time/cursor index, không sort toàn bảng.
- [x] Dashboard không truy vấn raw GPS lịch sử.

#### Gate N08

- [x] SQL source, API và UI totals reconcile trên vertical-slice fixture.
- [x] 00:00/week/month/delayed-simulation tests pass.
- [x] OPERATIONS positive và visitor negative HTTP tests pass.
- [ ] Dashboard summary p95 < 1 giây trên dữ liệu staging đại diện.
- [x] Admin lint/typecheck/build và browser smoke dashboard/payment feed pass.
- [x] Evidence được ghi ở §10.

### Gate Wave D

- [ ] N07 `DONE`.
- [ ] N08 `DONE`.
- [x] Live map và dashboard có degraded state khi Redis/realtime lỗi.
- [ ] Privacy owner duyệt bằng chứng opt-out/TTL/no-trace.

## 8. Wave E — Hardening, tải và rollout

### N09 — Security, privacy, load và failure drills

Trạng thái: `BLOCKED`
Owner: `Codex`
Started: `2026-10-11`
Updated: `2026-10-13`

- [x] Root lint/typecheck/test/build pass.
- [x] Demo mode/production hard-disable drill pass.
- [x] QR token guessing/replay/expiry drill pass.
- [x] Demo phone rate-limit/enumeration drill pass: known/new cùng status/shape, raw phone không lộ, request 11 bị 429.
- [x] Concurrent payment/redemption/idempotency load pass.
- [x] DB restart trên container biệt lập không làm mất/nhân đôi payment/point/outbox event.
- [x] Redis restart/reconnect/backpressure drill pass tại local synthetic profile.
- [x] Socket authorization và expired-token handshake drill pass.
- [x] PII/secret/raw GPS automated source/schema scan pass.
- [x] Backup/restore cho payment/loyalty/audit data pass trên hai database tạm với fixture giao dịch thật.
- [x] Consistency check phát hiện chênh lệch order/ledger/balance đúng.
- [x] Alert/metric/runbook có operations owner và ngưỡng mặc định cho outbox/dead-letter/stuck payment.
- [x] Dependency/security scan được triage; Next runtime fixed, legacy mobile/tooling advisories tracked as blocker NEW-B06.
- [ ] Capacity gate staging pass.
- [x] Production-candidate load được ghi rõ `NOT_VERIFIED`; local target-profile smoke không thay thế staging.
- [x] Staging gate runner có HTTPS/local guard, confirmation, deployment identity, dashboard p95, 10 admin maps, presence delta p95 và artifact aggregate mode `0600`.
- [x] Staging artifact chỉ nhận metric allowlist, tự kiểm tra profile/SLO và loại field lạ; stderr không được ghi vào report.
- [x] Offline artifact verifier kiểm tra file permission/type/size, schema, deployment identity, timestamp, field allowlist và SLO không cần credential.

#### Gate N09

- [x] Không còn blocker Critical/High chưa có mitigation được duyệt; không còn Critical, High còn lại thuộc legacy mobile bị loại khỏi web demo theo ADR 0006 và B04 có owner.
- [x] Payment/loyalty invariants pass dưới retry/restart/load tại local.
- [ ] Privacy/security report được duyệt.
- [x] Rollback/recovery runbook đã diễn tập local: migration down/up, backup/restore và DB restart.
- [x] Evidence được ghi ở §10.

### N10 — Staged rollout và acceptance

Trạng thái: `BLOCKED` — technical local preflight complete; rollout chưa bắt đầu
Owner: `Codex`
Started: `2026-10-13`
Updated: `2026-10-13`

- [ ] Seed ticket catalog được business duyệt.
- [ ] Seed reward catalog/rule được business duyệt.
- [x] Feature flags mặc định off ở production.
- [x] Local acceptance runner tạo artifact aggregate mode `0600`, không chứa phone/token/GPS.
- [x] Guarded local reset preview/confirm giữ nguyên catalog/admin/POI và đã diễn tập reset → restart → acceptance.
- [ ] Internal account pilot pass.
- [ ] QR/payment simulator pilot khớp order/ledger 100%.
- [ ] Staff/cashier pilot pass.
- [ ] Limited-user loyalty earn/redeem pilot pass.
- [ ] Presence opt-in/opt-out pilot pass.
- [ ] Dashboard khớp source records trong pilot.
- [ ] Support/cashier/operations được hướng dẫn.
- [ ] Retention/deletion/reset demo procedure được duyệt.
- [x] Tắt demo flags không mất dữ liệu đã commit; phone/payment endpoint trả 503 và order/credit vẫn nguyên qua restart drill.
- [x] `DEMO_MODE` và demo phone/payment endpoint hard-fail ở production config.
- [ ] GO/NO-GO có chữ ký/owner và danh sách blocker.

#### Gate N10

- [x] End-to-end phone → payment → points → dashboard pass ở local demo.
- [x] End-to-end consent → live map → revoke pass ở local automated/browser evidence.
- [x] Demo order, payment state, ledger và loyalty balance khớp 100% ở local drill.
- [x] Rollback drill pass ở local.
- [x] `docs/STATUS.md` và `docs/FEATURE_REGISTRY.md` đồng bộ.
- [x] Evidence được ghi ở §10 cho phần technical/local; pilot approval vẫn mở.

## 9. Checklist xuyên suốt mỗi task

### Trước khi code

- [x] Đọc task packet và required reading.
- [x] Dependency đã `DONE`.
- [x] `git status` đã kiểm tra và không ghi đè thay đổi agent khác.
- [x] Reuse-first search đã thực hiện.
- [x] Contract, test và file ownership đã xác định.
- [x] Giả định/rủi ro được ghi rõ.

### Trước handoff

- [ ] Diff chỉ chứa thay đổi trong scope.
- [x] Không có secret, phone thật, QR/access token hoặc raw GPS trong code/log/fixture; phone test đều là synthetic.
- [x] Formatter/lint/typecheck/test đúng phạm vi pass.
- [ ] Acceptance checks của task pass.
- [x] Migration/API/event có backward compatibility hoặc ADR/migration plan.
- [x] Feature registry được cập nhật.
- [x] Status board được cập nhật, không ghi `DONE` nếu còn lỗi bắt buộc.
- [x] Handoff dùng đúng format trong `AGENTS.md`.

## 10. Evidence log

Mỗi evidence ghi một dòng ngắn; không dán log dài.

| Date | Task | Evidence | Command/result hoặc artifact | Owner |
|---|---|---|---|---|
| — | — | — | — | — |
| 2026-10-11 | N00 | Demo product/privacy contract | `docs/adr/0016-demo-phone-loyalty-payment-and-live-operations.md` — ACCEPTED | Codex |
| 2026-10-11 | N01 | Contract + migration foundation | migration 017 `up/down/up` trên DB tạm — PASS; OpenAPI YAML parse — PASS | Codex |
| 2026-10-11 | N02–N04 | Identity/payment/loyalty vertical slice | `DEMO_OPERATIONS_TEST_DATABASE_URL=... npx vitest run apps/api/test/demo-operations.http.test.ts` — 2/2 PASS trên Postgres | Codex |
| 2026-10-11 | N05 | Payment workspace | payment lint/typecheck/build — PASS | Codex |
| 2026-10-11 | N05 | Browser payment happy path | local browser: admin login → phone lookup → adult ticket → QR page → succeeded → cashier shows 200 points — PASS | Codex |
| 2026-10-11 | N07–N08 | Presence/dashboard API và UI | RBAC + 3-session suppression HTTP — PASS; admin/visitor lint/typecheck/build — PASS | Codex |
| 2026-10-11 | N06 | Authenticated WebSocket + room authorization | `realtime.gateway.test.ts` — cashier room/event PASS, visitor denied; Redis adapter variant PASS | Codex |
| 2026-10-11 | N06 | Durable outbox relay | DB tạm: restart relay `2 published / 0 pending`; retry 10 → `RELAY_PUBLISH_FAILED` + dead-letter — PASS | Codex |
| 2026-10-11 | N07 | Redis latest-point/failure fallback | `presence.store.test.ts` với Redis 7 — cross-instance latest point + TTL ≤45s + memory fallback — 2/2 PASS | Codex |
| 2026-10-11 | N05–N08 | Realtime clients + quality gate | root typecheck — PASS; root test 637 pass/7 skipped; root build + scoped lint — PASS | Codex |
| 2026-10-11 | N07/N09 | Presence privacy/rate boundaries | foreground/movement throttle; replay 409, rate 429, park bounds/weak GPS 400; source/schema privacy scan — PASS | Codex |
| 2026-10-11 | N09 | Concurrent payment/redemption | real Postgres: concurrent confirm creates one credit; competing redemptions yield 201/409 and consistent balance — PASS | Codex |
| 2026-10-11 | N09 | Operations consistency checker | clean DB reports 0/0/0; intentional balance +1 reports `balanceMismatches:1` and exit 1 — PASS | Codex |
| 2026-10-11 | N07/N09 | Redis restart + local target-profile load | no API restart: Redis on/off/on all 0 failures; local 1,000 sockets + 500 publishers at 100 update/s, p95 connect 7 ms/update 44 ms — PASS, staging NOT_VERIFIED | Codex |
| 2026-10-11 | N09 | Dependency audit triage | Next 16.3.6 → 16.4.0, 3 web lint/build PASS; audit 44 → 43. Remaining 27 prod-tree advisories are legacy Expo/RN chain, tracked NEW-B06; no force downgrade | Codex |
| 2026-10-11 | N09 | Root quality snapshot | root typecheck/test/build — PASS; root lint blocked by 6 pre-existing search-script `no-undef` errors; scoped lint — PASS | Codex |
| 2026-10-11 | N08 | Timezone boundary + freshness UX | 23:59/00:00, đầu tuần/tháng và trạng thái payment `processing` trong delay đều PASS; admin lint/build PASS; live/delayed/partial/error hiển thị rõ | Codex |
| 2026-10-11 | N09 | Database backup/restore drill | full custom archive mode 0600; fixture 1 payment/3 ledger/2 redemption/2 outbox; source/restore counts match và invariant 0/0/0 — PASS | Codex |
| 2026-10-11 | N08 | Recent payment cursor feed | OpenAPI/shared client/API/UI; Postgres 2-page cursor + visitor 403 + bad cursor 400; 8 focused tests — PASS | Codex |
| 2026-10-11 | N08 | Dashboard query plan + browser | migration 019 up/down/up; local 100k orders: summary paid index ~7 ms, feed cursor index ~6 ms; browser shows masked pending/succeeded rows and matching 200k total — PASS, staging p95 NOT_VERIFIED | Codex |
| 2026-10-12 | N09 | Payment DB restart recovery | isolated Postgres restart at `processing`; API survives 57P01; retry same key → succeeded, balance match, credit/process/success = 1/1/1, outbox = 2, consistency 0/0/0 — PASS | Codex |
| 2026-10-12 | N09 | Demo-phone enumeration/rate | known/new response status+shape equal, raw phone absent; 11th burst request returns 429 — PASS | Codex |
| 2026-10-12 | N09 | Operations health alerts | clean DB healthy; intentional dead-letter reports `deadLetters:true` and exit 1; aggregate-only JSON — PASS | Codex |
| 2026-10-12 | N02 | Multi-signal demo auth + audited lookup | phone/IP/session/device limiter unit 2/2 PASS; real Postgres HTTP 2/2 PASS; `customer.lookup` audit count 2, no raw phone — PASS | Codex |
| 2026-10-12 | N03 | Audited admin loyalty adjustment | ADMIN-only HTTP; retry same idempotency key remains 150; over-debit 409; real Postgres ledger + `loyalty.adjust` audit count 1 — PASS | Codex |
| 2026-10-12 | N04 | Payment failure/token/restart hardening | tampered field 400; expired/invalid/consumed token; failed replay no credit; kill API at processing then retry same key → succeeded with credit/process/success 1/1/1; consistency 0/0/0 — PASS | Codex |
| 2026-10-12 | N05/N06 | Browser failure/offline/reconnect + event ordering | payment UI renders `FAILED`; remains stable while API offline; after API restart polling renders `EXPIRED`; invalidation gate rejects duplicate/out-of-order and resets on reconnect — PASS | Codex |
| 2026-10-12 | N06 | Standalone outbox worker topology | API internal relay off + worker relay + Redis adapter: inserted loyalty outbox event delivered to authenticated private room with schema v1/positive Redis sequence and marked published — PASS | Codex |
| 2026-10-12 | N08 | Operating-hour traffic filter | configurable 08:00–18:00 default; Vietnam boundary buckets 07:45/08:00/17:45/18:00 and invalid-range fallback — 2/2 PASS | Codex |
| 2026-10-12 | N07/N09 | 1.000-marker browser + target profile | 1.000 sockets/1.000 publishers, 0 failures, connect p95 6 ms/update p95 58 ms; dashboard showed 1.000 online and interactive MapLibre zoom — PASS local, staging NOT_VERIFIED | Codex |
| 2026-10-12 | N09 | Root quality + dependency audit | typecheck PASS; test 656 pass/7 skipped; build PASS; audit fix removes Critical and non-mobile fixable High; 15 High remain legacy mobile under ADR 0006/B04; root lint still blocked by 6 owned search-script globals | Codex |
| 2026-10-12 | N09 | Root lint closure | lint-only global declarations added to four search scripts; `npm run lint` and `git diff --check` — PASS | Codex |
| 2026-10-12 | N10 technical | Demo flags off preserves committed data | API restart drill: phone/payment endpoint 503 with flags off; existing order and single credit remain — PASS | Codex |
| 2026-10-12 | N07–N09 | Release review packet + staging profile | privacy/security packet ở `docs/runbooks/operations-privacy-security-review.md`; realtime harness đo/fail theo presence delta p95 và 10 admin maps; owner approval/staging execution vẫn mở | Codex |
| 2026-10-12 | N07–N09 | Staging-gate harness verification | Node 24.7/npm 11.5: syntax + ESLint + Prettier + API typecheck PASS; focused privacy/realtime/presence/dashboard/feed tests 13 pass/1 Redis skip | Codex |
| 2026-10-12 | N09 | Guarded staging gate runner | Missing-confirm/local-URL negative checks exit 1; exclusive artifact mode 0600; credential/API URL leak scan clean; staging execution still open | Codex |
| 2026-10-12 | N08/N09 | Deterministic traffic fixture + root regression | HTTP fixture uses explicit 00–24 test operating window instead of wall-clock-dependent default; focused test pass twice; root lint PASS; root test 661 pass/7 skipped including 5 staging-runner regressions | Codex |
| 2026-10-13 | N09 | Privacy-safe staging artifact boundary | Dashboard/realtime aggregate allowlist + profile/SLO validation; unknown token/GPS fields dropped; child stderr excluded; staging-runner tests 6/6 PASS | Codex |
| 2026-10-13 | N09 | Offline staging artifact verifier | `npm run operations:gate:verify -- <report>`; valid private artifact PASS; injected field và mode 0644 rejected; gate/verifier tests 7/7 PASS | Codex |
| 2026-10-13 | N02–N09 local demo | One-command operations demo | `demo.mjs start/status`: visitor/admin/payment/API/embedding/worker healthy; realtime smoke 20 sockets/10 publishers/2 admin maps, 0 failures, presence delta p95 4 ms — PASS local, staging NOT_VERIFIED | Codex |
| 2026-10-13 | N10 technical | Local acceptance + reset drill | acceptance 10/10 PASS; guarded reset 3 users/2 orders/4 ledger/2 redemption/4 outbox → 0, 5 Redis presence keys removed, catalogs preserved; restart + acceptance 10/10 PASS | Codex |
| 2026-10-13 | N07A | Post-payment presence onboarding | two synthetic phones: payment succeeded → visitor consent prompt → Gate 1 fallback; admin snapshot 2 distinct pseudonyms/avatar variants/coordinates; visitor 151 tests + lint/typecheck/build, admin lint/typecheck/build, payment lint/typecheck/build PASS | Codex |
| 2026-10-13 | N07B | Logged-in marker + ticket status | browser: login → one Gate 1 marker `Chưa mua vé` → payment succeeded → `Đã mua vé` + consent prompt → replacement marker remains one; API 192 pass/1 skip, visitor 151 pass, admin 108 pass, scoped lint/typecheck/build PASS | Codex |
| 2026-10-13 | N07C | Paid-today reopen | Vietnam midnight boundary regressions PASS; browser fresh visit with today's paid account → location prompt + existing Gate 1 fallback → decline → exactly one paid marker; API 193 pass/1 skip, visitor 152 pass, lint/typecheck/build PASS | Codex |

Mẫu:

```text
2026-MM-DD | N04 | Duplicate demo confirm idempotency | npm test -- ... — PASS; docs/runbooks/... | <owner>
```

## 11. Blocker và quyết định mở

| ID | Task | Blocker/decision | Owner | Needed action | Status | Updated |
|---|---|---|---|---|---|---|
| NEW-B01 | N00 | Payment simulator states/delay | Codex | Chốt ở ADR 0016: 5-minute QR, 2-second processing | RESOLVED | 2026-10-11 |
| NEW-B02 | N00 | Demo phone không xác minh chủ sở hữu | Codex | Synthetic-only, banner và production hard-disable ở ADR 0016 | RESOLVED | 2026-10-11 |
| NEW-B03 | N00/N07 | Live presence cần privacy/retention contract | Codex | Consent, Redis TTL 45s, no raw trace ở ADR 0016 | RESOLVED_FOR_DEMO | 2026-10-11 |
| NEW-B04 | N00/N09 | Chưa có số tải peak thực tế của công viên | Codex | Dùng staging gate tạm từ ADR 0016; production target không được claim | MITIGATED | 2026-10-11 |
| NEW-B05 | N09 | Root lint có 6 lỗi ngoài scope trong search catalog/scripts đang thay đổi song song | Search owner | Đã thêm lint-only Node globals; root lint pass | RESOLVED | 2026-10-12 |
| NEW-B06 | N09 | Audit còn 15 High trong legacy Expo/React Native chain; npm đề xuất downgrade major không tương thích | Mobile/platform owner | Giữ mobile ngoài demo deployment theo ADR 0006; nâng Expo/RN có kiểm thử riêng, không dùng `audit fix --force` | OPEN/MITIGATED_FOR_WEB_DEMO | 2026-10-12 |
| NEW-B07 | N07–N09 | Không có HTTPS staging target, deployment SHA hoặc synthetic admin credential trong repo/process environment | Coordinator/platform | Cấp sáu biến bắt buộc `OPERATIONS_STAGING_*` đã liệt kê trong `.env.example`, deploy đúng commit và chạy guarded staging gate + offline verifier | OPEN/BLOCKING | 2026-10-13 |
| NEW-B08 | N07–N10 | Thiếu privacy/security, business catalog và pilot acceptance owners/evidence | Coordinator + privacy/security + business/operations owners | Điền approval record, duyệt synthetic catalog, thực hiện pilot/training và ký GO/NO-GO | OPEN/BLOCKING | 2026-10-13 |

## 12. Backlog ngoài MVP

- [ ] Tier loyalty/member level.
- [ ] Coupon/promotion engine.
- [ ] Point expiry campaign.
- [ ] Ticket issuance/validation tại cổng.
- [ ] Accounting export được finance duyệt.
- [ ] Multi-park/multi-tenant.
- [ ] Historical heatmap chỉ từ aggregate đã đủ privacy threshold.
- [ ] Production capacity cao hơn gate mặc định sau khi có số liệu peak thật.
