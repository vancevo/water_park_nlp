# Runbook — nghiệm thu và reset operations demo local

## Phạm vi và verdict

Đây là pilot kỹ thuật chỉ chạy trên loopback với identity synthetic. Không thay
thế HTTPS staging, phê duyệt privacy/security, business approval hoặc pilot có
nhân sự thật.

- Local technical verdict: `GO` cho demo trên một máy.
- Shared staging/production verdict: `NO-GO` cho tới khi NEW-B07 và NEW-B08 được
  đóng bằng artifact và chữ ký owner.

## Catalog synthetic cần business duyệt

| Code | Tên demo | Giá mô phỏng | Điểm |
|---|---|---:|---:|
| `DEMO_ADULT` | Vé demo người lớn | 200.000 VND | 200 |
| `DEMO_CHILD` | Vé demo trẻ em | 120.000 VND | 120 |
| `DEMO_COMBO` | Vé demo combo | 300.000 VND | 350 |
| `DEMO_DRINK` | Nước uống demo | — | đổi 100 điểm |
| `DEMO_GIFT` | Quà lưu niệm demo | — | đổi 300 điểm |

Các giá trị trên là fixture giáo dục, không phải bảng giá/cam kết thương mại.
Business owner phải ghi quyết định vào record cuối tài liệu trước staged pilot.

## Nghiệm thu tự động

Khởi động demo rồi chạy:

```text
npm run operations:acceptance:local
```

Runner chỉ chấp nhận API HTTP loopback, tạo một phone synthetic ngẫu nhiên và
kiểm tra trọn luồng: catalog, phone session, payment, credit điểm, đổi quà,
recent-payment feed, dashboard reconciliation, presence opt-in/opt-out và PII
boundary. Artifact JSON aggregate được tạo exclusive với mode `0600` trong
`deliverables/`; artifact không chứa phone, QR token, access token hay tọa độ.

PASS gần nhất sau một reset sạch:
`deliverables/operations-local-acceptance-2026-10-13T01-09-21-894Z.json`.

## Kịch bản hướng dẫn nhân sự

1. Cashier mở `http://localhost:3003`, đăng nhập tài khoản admin local và chỉ
   nhập số điện thoại synthetic.
2. Visitor mở `http://localhost:3002`, đăng nhập cùng số, xác nhận đây là luồng
   không OTP và payment mô phỏng.
3. Cashier tạo order/QR; visitor xác nhận. Cả hai đối chiếu trạng thái
   `succeeded`, số điểm và reward redemption.
4. Operations mở `http://localhost:3001/dashboard`, kiểm tra revenue có nhãn mô
   phỏng, payment feed chỉ có phone masked và freshness state.
5. Visitor bật chia sẻ vị trí, operations xác nhận avatar xuất hiện; visitor
   tắt chia sẻ và operations xác nhận điểm biến mất ngay.
6. Nếu order/ledger không khớp, dừng demo và chạy `npm run operations:check`;
   không sửa tay ledger hoặc replay token mới.

Việc có runbook không đồng nghĩa support/cashier/operations đã được đào tạo;
owner vẫn phải ghi ngày, người tham gia và kết quả pilot.

## Reset dữ liệu demo

Reset chỉ chấp nhận database local cố định `127.0.0.1:64321/damsen`, từ chối
production/non-loopback và từ chối khi API còn chạy. Dừng demo trước:

```text
node scripts/demo/demo.mjs stop
npm run operations:demo:reset
```

Lệnh đầu tiên của reset chỉ preview aggregate và trả confirmation phrase. Để
thực thi:

```text
OPERATIONS_DEMO_RESET_CONFIRM=reset-local-demo-operations npm run operations:demo:reset
```

Script xóa phone identity synthetic, order/payment events, ledger/redemption,
outbox, operations audit liên quan và presence Redis; ticket/reward catalog,
admin, POI và narration được giữ lại. Sau reset, chạy lại demo và acceptance.

Drill 2026-10-13: `3 synthetic users / 2 orders / 4 ledger / 2 redemption / 4
outbox` về toàn bộ `0`; 5 presence Redis keys được xóa, catalog được giữ; demo
restart và acceptance 10/10 PASS.

## Approval record bắt buộc trước staged rollout

| Quyết định | Owner | Ngày | Kết quả/artifact |
|---|---|---|---|
| Ticket/reward catalog | Business | — | `PENDING` |
| Privacy/security report | Privacy + Security | — | `PENDING` |
| Cashier/support/operations pilot | Operations | — | `PENDING` |
| GO/NO-GO staging | Coordinator | — | `NO-GO` — NEW-B07/NEW-B08 open |
