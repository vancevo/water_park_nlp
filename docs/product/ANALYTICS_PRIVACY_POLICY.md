# Chính sách analytics tối thiểu cho MVP

Tài liệu này hiện thực hóa [ADR 0005](../adr/0005-gps-and-analytics-privacy.md) cho `POST /v1/events/batch`. Đây là giới hạn kỹ thuật của MVP, không thay thế phê duyệt pháp lý trước production.

## Thu thập khi có đồng ý

- API chỉ nhận batch khi `consent.analytics` là `true` và có `policyVersion`.
- Người dùng đăng nhập được gắn `user_id`; guest dùng UUID phiên ngẫu nhiên có thể reset. API không lưu cả hai identity trên cùng một event.
- Chỉ bảy loại event sản phẩm được phép: mở app, xem POI, bắt đầu/kết thúc thuyết minh, yêu cầu/bắt đầu/hoàn tất chỉ đường.
- Payload chỉ chứa POI ID, locale và lựa chọn accessibility khi loại event cho phép.

## Dữ liệu bị cấm

API từ chối tọa độ, GPS trail, route geometry/polyline, địa chỉ, email, số điện thoại, tên đầy đủ, token/password, advertising ID, device ID và IP trong payload. GPS chính xác chỉ được xử lý tức thời bởi routing theo ADR 0005; không được đưa vào analytics hay log.

## Retention và xóa

- Event được đặt `retention_until = received_at + 30 ngày`; đây là trần kỹ thuật MVP.
- Job vận hành phải chạy ít nhất hằng ngày: `DELETE FROM analytics_events WHERE retention_until <= now();`.
- Khi xóa account, event gắn với `user_id` bị xóa theo foreign-key cascade; event guest không được nối ngược vào account.
- Production vẫn bị chặn cho đến khi product/legal/security phê duyệt retention, withdrawal và account-deletion procedure như ADR 0005 yêu cầu.
- Shared staging chỉ dùng identity tổng hợp. Không bật collector GPS nghiên cứu trong public build.

## Giới hạn chống lạm dụng

Mỗi request có tối đa 50 event và 32 KiB; mỗi event tối đa 4 KiB. Event cũ hơn 30 ngày hoặc ở tương lai quá 5 phút bị từ chối. `eventId` là UUID v4 do client tạo và là khóa idempotency; retry không tạo bản ghi trùng.
