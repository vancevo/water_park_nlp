# Review packet — operations privacy và security

## Phạm vi và trạng thái

Packet này phục vụ gate N07/N09 cho demo giáo dục: phone identity không OTP, loyalty, QR payment mô phỏng, live presence opt-in và operations dashboard. Đây là bằng chứng để privacy/security owner duyệt; tài liệu không tự thay thế chữ ký duyệt.

- Review status: `AWAITING_OWNER_APPROVAL`
- Technical evidence date: `2026-10-12`
- Governing decision: [ADR 0016](../adr/0016-demo-phone-loyalty-payment-and-live-operations.md)
- Public/production use: `NOT_APPROVED`

## Data inventory và control

| Data | Purpose | Storage/retention | Access | Evidence |
|---|---|---|---|---|
| Demo phone | Mở synthetic account | HMAC lookup + last4 trong Postgres; không lưu raw phone | Auth boundary; cashier lookup trả masked value và được audit | N02 real-DB HTTP, enumeration/rate-limit và audit tests |
| QR token | Mở một demo order | Chỉ lưu token hash, expiry và consumed time | Public endpoint chỉ trả order summary đã redaction | Invalid/expired/consumed/tampered/replay tests |
| Payment/loyalty | Chứng minh transaction và dashboard demo | Postgres, immutable ledger/audit; backup theo retention môi trường | CASHIER/OPERATIONS/ADMIN theo RBAC | Concurrent confirm/redemption, restart, backup/restore và consistency drills |
| Raw live location | Live map khi user opt-in | Latest point trong Redis, TTL 45 giây; xóa ngay khi stop/revoke; không lưu trace trong Postgres | OPERATIONS/ADMIN; socket room kiểm tra role | Presence boundary/store/realtime tests và source/schema scan |
| Zone aggregate | Traffic chart | Postgres aggregate 15 phút; không user ID/coordinate; count dưới 3 bị suppress | OPERATIONS/ADMIN | Dashboard traffic/privacy tests |

## Abuse và failure controls đã kiểm chứng

- Demo phone/payment hard-fail khi flag tắt và bị từ chối trong production config.
- Phone limiter dùng nhiều tín hiệu; known/new account giữ cùng status/shape để giảm enumeration.
- QR opaque, one-time, có expiry; confirm/retry/restart không tạo credit lặp.
- Payment, loyalty credit và outbox giữ invariant dưới concurrent request, API restart và DB restart.
- Socket handshake yêu cầu access token; room payment và operations áp RBAC server-side.
- Redis outage không làm thay đổi Postgres source of truth; REST snapshot/polling là fallback.
- Health check cảnh báo pending/dead-letter/stuck payment bằng aggregate output; không in PII/token/GPS.
- Backup file mode `0600`; restore từ chối target production-like và yêu cầu confirmation rõ ràng.

## Residual risks và điều kiện duyệt

| Risk | Current treatment | Required owner decision |
|---|---|---|
| Phone login không chứng minh ownership | Synthetic-only, banner không OTP, production hard-disable | Xác nhận không dùng phone thật trên shared staging |
| Live location vẫn nhạy cảm dù TTL ngắn | Opt-in foreground, role restriction, TTL/revoke, no-trace | Duyệt consent copy, 45-second TTL và operator access |
| Local load không chứng minh staging capacity | Kết quả local ghi `NOT_VERIFIED`; guarded runner không chấp nhận loopback/local | Chạy `npm run operations:gate:staging`, xác minh bằng `npm run operations:gate:verify -- <report>` và duyệt artifact aggregate |
| Demo revenue không phải accounting | UI ghi rõ mô phỏng, chỉ tính successful demo orders | Xác nhận không xuất/diễn giải như doanh thu thật |
| Legacy mobile dependency advisories | Mobile bị loại khỏi web demo theo ADR 0006/B04 | Platform owner giữ exclusion hoặc mở task nâng cấp riêng |

## Approval record

Privacy owner điền phần này sau khi xem ADR, consent UI, test evidence và staging policy:

```text
Decision: APPROVED / APPROVED_WITH_CONDITIONS / REJECTED
Scope: educational demo only
Reviewer:
Reviewed at:
Conditions / expiry:
Evidence artifact links:
```

Security owner điền phần này sau khi xem RBAC, abuse tests, dependency triage và recovery evidence:

```text
Decision: APPROVED / APPROVED_WITH_CONDITIONS / REJECTED
Scope: educational web demo only
Reviewer:
Reviewed at:
Conditions / expiry:
Evidence artifact links:
```

Cho tới khi hai record có quyết định phù hợp và staging capacity pass, N07/N08 tối đa là `REVIEW`, N09 là `IN_PROGRESS`, và N10 không được bắt đầu rollout.
