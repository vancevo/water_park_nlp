# ADR 0016: Demo phone identity, loyalty, QR payment simulation and live operations

- Status: Accepted for the educational demo
- Date: 2026-10-11

## Context

The educational demo needs to show a complete visitor journey: identify a visitor by phone number, sell a synthetic ticket through a QR flow, add loyalty points, notify the visitor web app, update an operations dashboard and optionally show consenting visitors on an admin map.

The demo does not need SMS ownership verification or real money movement. Connecting a real payment provider, presenting a real bank QR or implying that money was collected would add cost, legal obligations and failure modes that are outside this project.

ADR 0005 forbids persisted raw GPS traces. A live operations view therefore needs an explicit, narrow exception for transient, opt-in presence only.

## Decision

### Demo boundary

- The feature is `DEMO_ONLY`. `DEMO_MODE`, `DEMO_PHONE_AUTH_ENABLED` and `DEMO_PAYMENTS_ENABLED` default to `false` outside explicit development/demo configuration.
- API startup rejects demo phone/payment enablement when `NODE_ENV=production`.
- Every phone-login and payment screen states `MÔ PHỎNG — KHÔNG PHẢI THANH TOÁN THẬT`.
- Shared staging uses synthetic phone numbers only. No SMS is sent and ownership of a phone number is not claimed.
- The demo never asks for bank, card or wallet credentials and does not use a real provider logo or payment QR format.

### Phone identity

- Accept Vietnamese demo numbers in `0xxxxxxxxx` or `+84xxxxxxxxx` form and normalize to E.164.
- Persist only an HMAC lookup hash and the final four digits. Do not persist or log the raw normalized phone.
- Entering the same normalized phone opens the same visitor account and issues the existing access/refresh session. Existing email/password accounts and admin login remain compatible.
- The demo phone-session endpoint is rate limited and hard-disabled outside demo mode.

### Ticket and points rules

- Seed clearly synthetic products, not official Dam Sen prices:

| Code | Display name | Demo amount | Points |
|---|---|---:|---:|
| `DEMO_ADULT` | Vé demo người lớn | 200,000 VND | 200 |
| `DEMO_CHILD` | Vé demo trẻ em | 120,000 VND | 120 |
| `DEMO_COMBO` | Vé demo combo | 300,000 VND | 350 |

- The server owns price and points. An order item stores price/points snapshots.
- Loyalty uses an immutable ledger. Payment success, point credit and outbox event commit in one database transaction and share a unique source key.
- Reward redemption is transactional and cannot spend the same balance twice. Admin adjustments require actor and reason.

### QR payment simulation

- Cashier creates an order by selecting a demo account and product quantities.
- QR contains only a random one-time URL token. The database stores its hash, expiry and consumed time; it never embeds phone, user ID, amount or points.
- The public demo page shows a redacted order summary and an explicit `Thanh toán demo` action.
- Default QR lifetime is five minutes. Confirmation moves `pending -> processing`, waits two seconds for presentation, then moves to `succeeded`. Test-only dependency injection may select `failed`.
- Repeated clicks, retries and process recovery are idempotent. Only the first valid success creates a loyalty credit.
- Cashier and visitor clients receive `payment.status.v1` and `loyalty.balance_changed.v1`. REST order/balance reads remain authoritative after reconnect.

### Dashboard definitions

- All calendar boundaries use `Asia/Ho_Chi_Minh`.
- `simulatedRevenue` is the sum of successful demo order amounts by `paid_at`.
- Dashboard labels every monetary figure as simulated.
- `payingUsers` counts distinct user IDs with a successful demo order; `activeVisitors` and `onlineNow` remain separate metrics.
- Peak/quiet traffic uses distinct consenting presence sessions in 15-minute buckets during configured operating hours.

### Live presence privacy and load

- Sharing is off by default and starts only after an explicit foreground consent action.
- For the local classroom demo only, a signed-in visitor may be represented before location consent by a clearly synthetic, session-derived marker near Gate 1. This marker communicates account availability, not the visitor's actual location; it never reads device location and exposes no phone or user ID. Sharing an actual device location remains off by default and still requires explicit foreground consent.
- The visitor sends at most every five seconds and only after approximately ten metres of movement, subject to GPS accuracy checks.
- Exact current location, selected destination and pseudonym live only in Redis with a 45-second TTL. Stop/revoke deletes the key immediately.
- Postgres may store session lifecycle/consent audit but no raw coordinate or route trace.
- Persisted 15-minute zone aggregates contain no user ID/coordinate and suppress counts below three.
- The admin sees a session-derived pseudonym/avatar. Destination is shown only when the visitor explicitly selected a route.
- The staging gate is 1,000 connected sockets, 500 publishers at five-second intervals and 10 admin maps. The production-candidate target remains informational for this demo.

### Roles and access

- Add `CASHIER` for the cashier app and `OPERATIONS` for dashboard/live map. `ADMIN` retains access to both.
- Cashier cannot access live presence. Operations cannot adjust points unless also `ADMIN`.
- Room subscription and REST endpoints enforce the same authorization server-side.

## Consequences

- The demo can show the requested experience without external SMS/payment dependencies.
- Phone login is not authentication suitable for real users. It must not be promoted to production or used with real phone data.
- Simulated revenue is product-demo data, not accounting data.
- The immutable payment/loyalty design still demonstrates correct idempotency and can inform a later real integration, but a real provider requires a new ADR, signed webhook verification, reconciliation, refund and compliance work.
- Live operations remains privacy-sensitive even in a demo; raw location retention or background tracking requires another explicit decision.

## Acceptance summary

- Same synthetic phone reopens one account without OTP.
- Cashier creates a QR, a scanner opens the demo page, confirmation reaches `succeeded`, points are credited once and the visitor web receives a notification.
- Duplicate confirmation or restart does not duplicate points.
- Demo endpoints refuse to run in production configuration.
- Opt-out removes live presence immediately and no raw GPS is persisted.
- A signed-in local-demo visitor appears as a synthetic Gate 1 marker; operations can distinguish successful-ticket and no-ticket states without receiving visitor identity or phone data.
