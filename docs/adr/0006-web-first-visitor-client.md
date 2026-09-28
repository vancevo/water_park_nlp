# ADR 0006: Web-first visitor client

- Status: Accepted
- Date: 2026-09-25
- Supersedes: phần lựa chọn visitor client trong ADR 0001

## Context

Chủ dự án chọn web app thay cho binary iOS/Android để giảm chi phí cài đặt,
build native và phân phối trong giai đoạn học tập. Admin vẫn là một web app
riêng. API, spatial model và privacy constraints không thay đổi.

## Decision

- `apps/visitor-web` là client chính cho Guest/VISITOR, dùng Next.js responsive.
- Dùng MapLibre GL JS, Web Geolocation API, HTML audio và typed API client có
  sẵn; không sao chép business logic từ mobile.
- Guest có thể xem/search POI, đọc/nghe thuyết minh và yêu cầu tuyến đường.
- User có thể đăng ký/đăng nhập với role `VISITOR`; token MVP chỉ tồn tại trong
  `sessionStorage` của tab.
- Web chỉ yêu cầu vị trí sau hành động rõ ràng. Production phải dùng HTTPS và
  tiếp tục tuân thủ ADR 0005.
- Bản đồ mặc định là sơ đồ nghiên cứu synthetic, không gọi public tile server.
  Style/tile production vẫn đi qua configuration boundary và legal gate ADR
  0002.
- `apps/mobile` được giữ làm prototype tham khảo, không nằm trên critical path
  phát hành web và không nhận feature mới nếu không có quyết định khác.

## Consequences

Một URL chạy trên desktop/mobile browser, không cần App Store hoặc development
build. GPS nền, native offline map và native secure storage không còn thuộc MVP.
Khả năng install/offline hoàn chỉnh cần service worker và chiến lược cache riêng
trong T50.
