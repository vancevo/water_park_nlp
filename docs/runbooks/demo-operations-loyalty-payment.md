# Runbook — demo tài khoản, điểm, payment và operations dashboard

## Phạm vi

Đây là vertical slice giáo dục. Không gửi OTP, không gọi cổng thanh toán và mọi số tiền đều là mô phỏng. Runtime từ chối bật demo khi `NODE_ENV=production`.

## Khởi động local

Nếu repository đã được setup bằng bộ demo, chỉ cần chạy một lệnh. Runner tự bật
phone demo, loyalty/payment, Redis realtime, outbox relay và mở đủ visitor,
admin, payment:

```text
node scripts/demo/demo.mjs start
```

Kiểm tra nhanh bằng `node scripts/demo/demo.mjs status`; cả sáu dòng visitor,
admin, payment, API, embedding và worker phải có dấu `✓`. Các bước thủ công dưới
đây chỉ dùng khi cần chạy từng service để phát triển.

Nghiệm thu trọn luồng local bằng `npm run operations:acceptance:local`. Quy trình
pilot, artifact và reset an toàn nằm tại
[`operations-local-pilot.md`](operations-local-pilot.md).

1. Sao chép `.env.example` thành `.env` và đặt `DEV_ADMIN_PASSWORD` cùng `DEMO_PHONE_HMAC_SECRET` chỉ dùng local.
   Đặt `REALTIME_REDIS_ENABLED=true` và `NEXT_PUBLIC_REALTIME_URL=http://localhost:3000/realtime` để bật scale-out transport local.
2. Chạy migration: `npm run db:migrate`.
3. Mở bốn process:
   - `npm run dev:api` — API `:3000`.
   - `npm run dev:visitor` — visitor `:3002`.
   - `npm run dev:payment` — quầy/QR `:3003`.
   - `npm run dev --workspace @damsen/admin-web` — admin `:3001`.
4. Dùng tài khoản seed `admin@damsen.local` và mật khẩu từ `DEV_ADMIN_PASSWORD` cho quầy và dashboard.

Khi chạy relay thành process riêng, đặt `OPERATIONS_OUTBOX_RELAY_ENABLED=false` cho API và chạy worker với cùng `DATABASE_URL`/`REDIS_URL` cùng `OPERATIONS_OUTBOX_RELAY_ENABLED=true npm run operations:relay`. Nếu không chạy worker riêng, API relay mặc định vẫn là fallback local. Không bật đồng thời hai relay trong deployment chuẩn.

## Kịch bản demo

1. Visitor `:3002`: bấm **Đăng nhập**, nhập số thử nghiệm, không có OTP; đặt người mô phỏng trên map nếu muốn chia sẻ vị trí.
2. Payment `:3003`: đăng nhập admin, nhập cùng số, chọn vé và tạo QR.
3. Quét QR hoặc bấm link, chọn **Thanh toán demo**. Server giữ trạng thái processing khoảng 2 giây rồi cộng điểm đúng một lần.
4. Trở lại hộp **Điểm** trên visitor; WebSocket báo thay đổi rồi client đọc lại REST. Polling 2 giây vẫn hoạt động nếu socket lỗi. Có thể đổi quà nếu đủ điểm.
5. Admin `:3001/dashboard`: xem doanh thu mô phỏng, khách hoạt động, bucket đông/vắng và các avatar đang chia sẻ vị trí.
   Bảng giao dịch gần đây chỉ hiển thị số điện thoại đã che và dùng cursor khi bấm **Xem thêm**.

## Privacy và giới hạn hiện tại

- Phone được chuẩn hóa rồi HMAC để lookup; database chỉ giữ hash và 4 số cuối. Không dùng số thật trên shared staging.
- Live GPS chỉ giữ latest point trong Redis với TTL 45 giây khi bật; mất Redis sẽ hạ cấp về memory. Tắt consent xóa ngay. Bucket dưới 3 phiên hiển thị 0.
- Payment/loyalty/order là transaction bền vững trong Postgres. Migration 018 bổ sung outbox retry/backoff/dead-letter; Socket.IO Redis adapter phát event giữa nhiều API instance. Socket chỉ là tín hiệu, REST vẫn là source of truth.
- Chưa claim production capacity, payment thật, OTP thật hay accounting-grade revenue.

## Verification

Dùng Node `24.x` và npm `11.5.x` theo root `engines`/`.nvmrc` trước khi chạy gate; runtime cũ hơn không có `node:crypto.argon2` mà auth module sử dụng.

```text
npx vitest run apps/api/test/auth-workflow.http.test.ts apps/api/test/demo-operations.http.test.ts apps/api/test/realtime.gateway.test.ts apps/api/test/presence.store.test.ts
npm run typecheck --workspaces --if-present
npm run build --workspace @damsen/api
npm run build --workspace @damsen/payment-web
npm run build --workspace @damsen/admin-web
npm run build --workspace @damsen/visitor-web
```

Migration `017_demo_operations` và `018_outbox_relay` phải chạy trên database tạm trước handoff. Với Redis local, chạy test presence bằng `PRESENCE_REDIS_TEST_URL=redis://127.0.0.1:6379`.
Migration `019_operations_dashboard_indexes` bổ sung index cho payment cursor và customer activity; đã được diễn tập `up/down/up` trên database tạm.

Kiểm tra invariant và tải local:

```text
DATABASE_URL=... npm run operations:check
OPERATIONS_LOAD_API_URL=http://127.0.0.1:3000 \
OPERATIONS_LOAD_CLIENTS=1000 \
OPERATIONS_LOAD_PUBLISHERS=500 \
OPERATIONS_LOAD_UPDATES_PER_SECOND=100 \
npm run operations:load:realtime
```

Load harness chỉ in aggregate count/latency, không in phone, token hoặc tọa độ. Kết quả local không được dùng để tuyên bố staging/production capacity.

Gate staging bắt buộc chạy trên deployment staging với dữ liệu đại diện và synthetic admin. Runner từ chối HTTP, loopback/local, thiếu deployment SHA hoặc thiếu confirmation; nó chạy dashboard benchmark rồi profile 1.000 visitor socket/500 publisher/10 admin map và lưu artifact aggregate mode `0600`:

```text
OPERATIONS_STAGING_GATE_CONFIRM=run-demo-staging-gate \
OPERATIONS_STAGING_API_URL=https://<staging-api> \
OPERATIONS_STAGING_ENVIRONMENT=<environment-name> \
OPERATIONS_STAGING_DEPLOYMENT_SHA=<deployed-commit-sha> \
OPERATIONS_STAGING_ADMIN_EMAIL=<synthetic-admin> \
OPERATIONS_STAGING_ADMIN_PASSWORD=<secret-from-runtime> \
npm run operations:gate:staging
```

Gate đạt khi artifact có `status=passed`, dashboard `p95Ms < 1000`, đúng 1.000 socket visitor và 10 admin map, không có failure, cả 10 admin map nhận delta, và `presenceDeltaP95Ms < 2000`. Runner kiểm tra lại profile/SLO thay vì chỉ tin exit code, chỉ ghi các metric trong allowlist và loại stderr/field lạ. Artifact mặc định nằm trong `deliverables/`, có ngày, deployment SHA và environment nhưng không chứa API URL, credential hay payload vị trí. Có thể đặt đường dẫn mới bằng `OPERATIONS_STAGING_REPORT`; runner dùng exclusive-create và không ghi đè artifact cũ.

Reviewer xác minh lại artifact mà không cần staging credential:

```text
npm run operations:gate:verify -- /secure/path/operations-staging-gate.json
```

Verifier chỉ chấp nhận regular file không phải symlink, tối đa 64 KiB, không cấp quyền group/other, đúng schema v1/status `passed`, timestamp/deployment identity hợp lệ, đúng field allowlist và đạt profile/SLO. Output xác minh chỉ chứa environment, deployment SHA, timestamp và hai metric p95.

## Backup và restore database

Archive là bản full database để giữ nguyên quan hệ giữa user, payment, loyalty, outbox và audit. File được đặt quyền `0600`; coi đây là dữ liệu nhạy cảm, lưu ngoài repository và áp dụng retention của môi trường.

```text
DATABASE_URL=... \
OPERATIONS_BACKUP_PATH=/secure/path/damsen.dump \
npm run operations:db:backup

DATABASE_URL=... \
OPERATIONS_BACKUP_PATH=/secure/path/damsen.dump \
OPERATIONS_RESTORE_DATABASE_URL=postgresql://.../damsen_restore_drill \
OPERATIONS_RESTORE_CONFIRM=replace-demo-database \
npm run operations:db:drill
```

Restore luôn từ chối source và target giống nhau, target có tên giống production, hoặc target không chứa `restore`, `test`, `demo`, `drill`, `tmp`. Nếu PostgreSQL client mặc định khác major version server, đặt `PG_DUMP_BIN` và `PG_RESTORE_BIN` tới binary tương thích. Drill so sánh aggregate row count của các bảng operations và chạy lại ba invariant balance/payment/redemption; output không chứa phone, token, GPS hay connection string.

## Payment DB-restart drill

Chỉ chạy với một Postgres container biệt lập. API phải trỏ vào database của container này và dùng processing delay đủ để restart khi order đang ở trạng thái `processing`.

```text
DATABASE_URL=postgresql://.../damsen_drill \
OPERATIONS_DRILL_API_URL=http://127.0.0.1:3010 \
OPERATIONS_DB_CONTAINER=damsen-operations-db-restart-drill \
OPERATIONS_DRILL_ADMIN_EMAIL=... \
OPERATIONS_DRILL_ADMIN_PASSWORD=... \
OPERATIONS_DB_RESTART_CONFIRM=restart-isolated-demo-db \
npm run operations:drill:db-restart
```

Script từ chối `NODE_ENV=production`, tên container chứa `prod`, hoặc thiếu confirmation. Kết quả đạt khi retry cùng idempotency key trả `succeeded`, balance bằng điểm order, chỉ có một credit ledger, một processing event, một succeeded event và hai outbox event. Sau drill chạy thêm `npm run operations:check`.

## Payment API-restart drill

Build API trước, migrate một database tạm có tên chứa `drill`, `demo` hoặc `test`, rồi chạy:

```text
DATABASE_URL=postgresql://.../operations_api_restart_drill \
OPERATIONS_API_RESTART_CONFIRM=restart-demo-api \
npm run operations:drill:api-restart
```

Script tự chạy API biệt lập, kill tiến trình khi order đang `processing`, khởi động API mới và retry cùng idempotency key. Sau đó script restart với toàn bộ demo flag tắt, xác nhận endpoint trả 503 nhưng order/credit đã commit vẫn nguyên. Gate đạt khi order `succeeded`, balance khớp, credit/processing/succeeded đều đúng một record và `flagsPreserveData=true`. Script từ chối production và database không có tên drill rõ ràng; output chỉ là aggregate.

## Health thresholds và owner

Owner mặc định của demo là người trực operations trong ca. Chạy `DATABASE_URL=... npm run operations:health` mỗi phút; JSON chỉ chứa aggregate counter và command trả exit code 1 khi có alert.

| Signal | Ngưỡng mặc định | Xử lý đầu tiên |
|---|---:|---|
| Pending outbox | > 100 | Kiểm tra API/relay và Redis, không xóa record |
| Oldest pending outbox | > 60 giây | Kiểm tra relay retry/dependency |
| Dead-letter | > 0 | Giữ record để điều tra schema/event, không replay mù |
| Payment processing bị kẹt | > 0 sau 60 giây | Retry cùng idempotency key, rồi chạy consistency check |

Ngưỡng có thể override bằng `OPERATIONS_ALERT_PENDING_OUTBOX`, `OPERATIONS_ALERT_OLDEST_PENDING_SECONDS`, `OPERATIONS_ALERT_DEAD_LETTERS`, `OPERATIONS_ALERT_STUCK_PAYMENTS` và `OPERATIONS_STUCK_PAYMENT_SECONDS`. Sau alert hoặc restart luôn chạy `npm run operations:check`; nếu invariant khác 0 thì dừng demo payment và giữ database để điều tra.

Web demo dùng Next.js 16.4.0 để loại advisory runtime đã phát hiện. Không đóng gói `apps/mobile` vào deployment của demo web: audit còn advisory critical/high trong chuỗi Expo/React Native và phương án tự động của npm là downgrade major không tương thích. Việc nâng mobile phải là task riêng có native compatibility test; không chạy `npm audit fix --force`.
