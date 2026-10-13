# README — Luồng demo Đầm Sen Smart Guide

Tài liệu này mô tả luồng trình bày hoàn chỉnh trên máy local: khách tham quan,
quầy vé/payment, loyalty, dashboard vận hành, chia sẻ vị trí và phần bản đồ –
thuyết minh AI.

Nếu chỉ cần hướng dẫn thao tác của người dùng cuối trên visitor web, xem
[`README-LUONG-USER.md`](README-LUONG-USER.md).

> Đây là demo giáo dục, phi thương mại. Phone không có OTP, payment không chuyển
> tiền thật, giá vé/điểm là dữ liệu synthetic và vị trí không dùng để dẫn đường
> ngoài thực địa.

## 1. Khởi động

Yêu cầu: Node.js 24, Docker Desktop và Python 3.12.

```bash
# Chỉ lần đầu
node scripts/demo/demo.mjs setup

# Mỗi lần demo
node scripts/demo/demo.mjs start

# Kiểm tra trạng thái
node scripts/demo/demo.mjs status
```

Khi sáu dịch vụ đều có dấu `✓`, mở:

| Vai trò             | URL                   | Mục đích                                                   |
| ------------------- | --------------------- | ---------------------------------------------------------- |
| Khách tham quan     | http://localhost:3002 | Bản đồ, tìm kiếm, dẫn đường, phone login, điểm và presence |
| Quản trị/operations | http://localhost:3001 | Dashboard, live map, POI và nội dung thuyết minh           |
| Quầy vé/payment     | http://localhost:3003 | Tìm khách, chọn vé, tạo QR và theo dõi order               |

Tài khoản quản trị local:

```text
Email: admin@damsen.local
Mật khẩu: DamSen-Demo-2026
```

## 2. Sơ đồ luồng chính

```mermaid
sequenceDiagram
    actor Visitor as Khách tham quan
    participant VisitorWeb as Visitor :3002
    actor Cashier as Nhân viên quầy
    participant PaymentWeb as Payment :3003
    participant API as API :3000
    participant DB as PostgreSQL
    participant RT as Redis + Realtime
    participant Admin as Dashboard :3001

    Visitor->>VisitorWeb: Nhập số điện thoại thử nghiệm
    VisitorWeb->>API: Tạo/mở demo phone session
    API->>DB: Lưu phone HMAC + 4 số cuối
    Cashier->>PaymentWeb: Đăng nhập và nhập cùng số điện thoại
    PaymentWeb->>API: Lookup khách + chọn vé
    API->>DB: Tạo order pending và QR token
    PaymentWeb-->>Visitor: Hiển thị QR/link thanh toán
    Visitor->>API: Xác nhận thanh toán mô phỏng
    API->>DB: processing → succeeded + ghi loyalty ledger
    API->>RT: Phát payment/loyalty/dashboard invalidation
    RT-->>VisitorWeb: Báo điểm thay đổi
    RT-->>PaymentWeb: Báo order thay đổi
    RT-->>Admin: Báo dashboard thay đổi
    VisitorWeb->>API: Đọc lại balance từ REST
    PaymentWeb->>API: Đọc lại trạng thái order từ REST
    Admin->>API: Đọc lại summary/feed từ REST
```

Realtime chỉ dùng để báo “dữ liệu đã thay đổi”. REST/PostgreSQL luôn là nguồn
sự thật, vì vậy giao diện vẫn tự hồi phục bằng polling nếu socket bị ngắt.

## 3. Luồng trình bày từng bước

### Bước A — Khách đăng nhập demo

1. Mở visitor `:3002` và chọn **Đăng nhập**.
2. Nhập một số thử nghiệm, ví dụ `0901234567`.
3. Hệ thống chuẩn hóa số rồi chỉ lưu HMAC và bốn số cuối; không có OTP.
4. Mở hộp **Điểm** để xem balance và reward catalog.

Luôn dùng số synthetic. Không nhập số thật của người tham gia.

### Bước B — Quầy tạo order và QR

1. Mở payment `:3003`, đăng nhập tài khoản quản trị local.
2. Nhập đúng số thử nghiệm ở bước A.
3. Chọn vé người lớn, trẻ em hoặc combo.
4. Bấm tạo order. Order bắt đầu ở trạng thái `pending` và QR có thời hạn.
5. Mở link QR trên cùng máy hoặc cửa sổ khác.

### Bước C — Thanh toán và cộng điểm

1. Bấm **Thanh toán demo** trên trang QR.
2. Order chuyển `pending → processing → succeeded` trong khoảng hai giây.
3. Server ghi payment, loyalty credit và outbox trong transaction.
4. Visitor tự cập nhật điểm; payment page cập nhật order; dashboard cập nhật
   doanh thu mô phỏng và recent-payment feed.

Retry cùng idempotency key không được cộng điểm lần hai. QR đã dùng không thể
dùng lại để tạo một giao dịch mới.

### Bước D — Đổi quà

1. Trở lại hộp **Điểm** trên visitor.
2. Chọn reward đủ điểm và xác nhận đổi.
3. Hệ thống ghi một ledger debit và trả fulfillment code.
4. Balance mới phải bằng tổng credit trừ tổng debit.

### Bước E — Dashboard operations

1. Mở `http://localhost:3001/dashboard`.
2. Kiểm tra riêng ba số: khách hoạt động, khách đã trả và người đang online.
3. Revenue luôn có nhãn **doanh thu mô phỏng**.
4. Recent payments chỉ hiển thị số điện thoại đã che.
5. `generatedAt`, timezone và freshness cho biết dữ liệu live/delayed/partial.

### Bước F — Live presence và opt-out

```mermaid
flowchart LR
    A[Khách bấm chia sẻ vị trí] --> B[Tạo presence session có consent]
    B --> C[Gửi latest point khi foreground]
    C --> D[Redis giữ tối đa 45 giây]
    D --> E[Admin live map đọc snapshot]
    E --> F[Khách bấm dừng chia sẻ]
    F --> G[Xóa point ngay và phát removed event]
```

Presence không lưu raw GPS trace trong PostgreSQL/log/analytics. Admin chỉ được
xem latest point còn TTL; zone aggregate dưới ba phiên bị suppression.

### Bước G — Bản đồ, tìm kiếm và thuyết minh AI

1. Trên visitor, tìm POI theo tên, không dấu, hướng hoặc nhu cầu.
2. Chọn POI và dùng người mô phỏng/dẫn đường trên walkway graph.
3. Nghe thuyết minh VI/EN đã tạo bằng Piper hoặc fallback sang giọng trình
   duyệt.
4. Trên admin, người biên tập có thể tạo audio nháp, nghe thử, gửi duyệt và chỉ
   xuất bản sau bước review của con người.

## 4. Trạng thái và dữ liệu được ghi

| Thành phần              | Nguồn sự thật      | Retention trong demo                  |
| ----------------------- | ------------------ | ------------------------------------- |
| Order/payment           | PostgreSQL         | Giữ tới khi reset demo                |
| Loyalty balance/ledger  | PostgreSQL         | Giữ tới khi reset demo                |
| Audit lookup/adjustment | PostgreSQL         | Giữ tới khi reset demo                |
| Latest presence point   | Redis              | TTL 45 giây hoặc xóa ngay khi opt-out |
| Realtime event          | Outbox + Redis     | Dùng để invalidation/retry            |
| POI/narration           | PostgreSQL + MinIO | Được giữ khi reset operations         |

## 5. Nghiệm thu tự động

Trong lúc demo đang chạy:

```bash
npm run operations:acceptance:local
```

PASS yêu cầu đủ 10 kiểm tra: catalog, phone session, payment, loyalty credit,
reward redemption, payment feed, dashboard reconciliation, presence opt-in,
presence opt-out và PII boundary. Báo cáo aggregate mode `0600` nằm trong
`deliverables/` và không chứa phone, QR/access token hay tọa độ.

Kiểm tra invariant database:

```bash
DATABASE_URL=postgresql://damsen:damsen_local_only@127.0.0.1:64321/damsen \
  npm run operations:check
```

Ba giá trị mismatch đều phải bằng `0`.

## 6. Reset và chạy lại

```bash
node scripts/demo/demo.mjs stop
npm run operations:demo:reset
```

Lệnh trên chỉ preview. Muốn thực thi reset local:

```bash
OPERATIONS_DEMO_RESET_CONFIRM=reset-local-demo-operations \
  npm run operations:demo:reset
node scripts/demo/demo.mjs start
```

Reset chỉ chấp nhận database local cố định, từ chối khi API còn chạy và giữ
nguyên catalog, admin, POI, audio. Chi tiết vận hành và approval record xem
[`../docs/runbooks/operations-local-pilot.md`](../docs/runbooks/operations-local-pilot.md).

## 7. Dừng demo và xử lý lỗi

```bash
node scripts/demo/demo.mjs stop
```

Nếu giao diện không cập nhật:

1. Chạy `node scripts/demo/demo.mjs status`.
2. Tải lại trang bằng F5.
3. Kiểm tra `.demo/logs/api.log`, `payment.log`, `admin.log` và `visitor.log`.
4. Chạy `npm run operations:check` trước khi sửa dữ liệu.

Không xóa/sửa ledger bằng tay và không dùng `audit fix --force` cho mobile
legacy. Demo local đã sẵn sàng; staging/public release vẫn cần capacity artifact
và chữ ký business/privacy/security.
