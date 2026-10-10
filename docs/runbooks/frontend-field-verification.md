# Xác minh vị trí POI tại hiện trường

Dành cho nhóm đi thực nghiệm: đo lại vị trí từng địa điểm (và cổng vào) bằng điện thoại,
ghi nhận kết quả và cập nhật POI mà **không làm địa điểm biến mất khỏi visitor**.

## Cách dùng (điện thoại)

1. Mở `https://<tunnel-HTTPS>/field` (điện thoại **chỉ lấy GPS trên HTTPS**) và đăng nhập.
2. Danh sách địa điểm sắp xếp theo khoảng cách tới bạn ("42 m về hướng Đông Bắc"), có
   thanh tiến độ (đã kiểm / tổng), lọc *Chưa kiểm / Đã kiểm / Cần chú ý*, ô tìm tên.
3. Bấm một địa điểm → bản đồ có chấm xanh (POI), chấm vàng (cổng), chấm xanh dương (bạn,
   kèm vòng sai số GPS). Dòng đầu cho biết bạn đang cách vị trí **đang lưu** bao xa, hướng nào.
4. Đứng **ngay giữa địa điểm** (hoặc ngay cổng) → **📍 Đo vị trí địa điểm tại đây** /
   **🚪 Đo cổng**. App thu ≥ 6 mẫu GPS tốt (sai số ≤ 25 m) trong ≥ 6 giây, bỏ mẫu lạc, lấy
   trung bình có trọng số theo độ chính xác và báo **sai số thật** (không bao giờ tốt hơn mẫu
   tốt nhất, và không nhỏ hơn độ dao động của các mẫu).
5. Xem kết quả: tọa độ, sai số, độ lệch so với vị trí đang lưu; chọn **Đúng vị trí / Đã đo
   lại / Có vấn đề**, **đường đi tới đây có đi được không**, ghi chú → lưu.
   - Tài khoản **Reviewer/Admin**: **Lưu và cập nhật luôn** dời POI (hoặc cổng) tới điểm vừa
     đo, trạng thái (đã xuất bản…) giữ nguyên, có ghi nhật ký `poi.location_corrected`.
   - Tài khoản **Editor**: chỉ lưu kết quả; Reviewer/Admin áp dụng sau ở `/field/review`.
6. **⚠ Báo vấn đề**: dùng cho địa điểm đóng cửa / không thấy / đường bị chặn (ghi chú bắt buộc).

## Mất sóng thì sao

Kết quả luôn được lưu trên máy trước (localStorage), rồi tự gửi khi có mạng (mỗi 30 giây và khi
máy báo online). Mỗi kết quả có `clientId` riêng nên gửi lại không bị trùng. Máy chủ từ chối
(ví dụ sai số > 50 m) thì kết quả được giữ lại và đánh dấu "bị từ chối", không mất. Đăng nhập
tự gia hạn (token 15 phút) nên đi cả buổi vẫn dùng được.

## Duyệt kết quả (máy tính hoặc điện thoại) — `/field/review`

Ba nhóm: *Cần áp dụng (đã đo lại)*, *Có vấn đề*, *Đã xác nhận đúng vị trí*. Mỗi dòng cho thấy độ
lệch, sai số, số mẫu, đường có đi được không, ghi chú, **bản đồ so sánh** (vị trí đang lưu vs vừa
đo) và nút **Áp dụng vị trí đo**. Với cổng, app tự gắn vào điểm đường đi bộ gần nhất
(từ chối nếu cách > 75 m — lúc đó tuyến chỉ đường sẽ không tìm được đường).

## Vì sao không sửa trực tiếp trong form POI

Sửa POI đã xuất bản bằng form (`PATCH`) đưa nó về **draft** → biến mất khỏi visitor tới khi duyệt
lại. Field check là *bằng chứng* tách riêng; "áp dụng" chỉ đổi toạ độ tại chỗ.

## Kỹ thuật

- API (contract v1.3, additive): `POST /v1/admin/pois/{id}/field-checks` (EDITOR+; 201, hoặc 200 nếu
  trùng `clientId`; 422 `FIELD_CHECK_ACCURACY_TOO_LOW` nếu sai số > 50 m), `GET /v1/admin/field-checks`
  (`?poiId=&applied=false`), `POST /v1/admin/field-checks/{id}/apply` (REVIEWER/ADMIN; cổng cần
  `graphNodeRef`). Bảng `poi_field_checks` (migration 014).
- Giới hạn: độ chính xác GPS điện thoại ngoài trời thường 3–10 m; dưới tán cây/gần nhà cao có thể
  > 20 m. Hãy đứng chỗ thoáng, đợi vòng sai số nhỏ lại, đo lại nếu nghi ngờ. Vị trí là ước lượng
  một lần đo, chưa phải khảo sát trắc địa; với điểm quan trọng nên đo ở 2 lần khác nhau.
- Kiểm thử: `field-browser-smoke.mjs` (đo → áp dụng → offline → duyệt, trên API + DB thật, GPS giả).

## Thêm địa điểm mới tại hiện trường — `/field/new`

Khi gặp một chỗ chưa có trong danh sách: **＋ Thêm địa điểm tại đây** (đầu trang `/field`). Đứng ngay giữa
địa điểm → **📍 Đo vị trí tại đây** (cùng cách đo nhiều mẫu như trên) → nhập tên (Việt bắt buộc, Anh để
trống thì dùng tên Việt), chọn loại (cổng, trò chơi, sân khấu, ăn uống, nhà vệ sinh…) → lưu. Lối vào chính
tự gắn vào điểm đường đi bộ gần nhất. Ba cách lưu: **Chỉ lưu nháp**, **Lưu và gửi duyệt**, và với
Reviewer/Admin **Lưu và xuất bản luôn**. Thêm địa điểm mới **cần có mạng** (khác với kết quả đo có hàng đợi
offline).

## Kiểm duyệt — `/review` (mục "Kiểm duyệt" ở thanh bên)

Hàng đợi có số địa điểm đang chờ ngay trên thanh bên. Ba tab: **Chờ duyệt** (Duyệt / Từ chối kèm lý do ≥ 3
ký tự / **Duyệt tất cả**), **Bản nháp** và **Bị từ chối** (hiện lý do; **Gửi duyệt** khi đủ tên Việt, tên
Anh và một cổng chính). Mỗi thẻ có bản đồ nhỏ và nút mở form sửa. Chỉ Reviewer/Admin duyệt hoặc từ chối;
Editor chỉ gửi duyệt. Kiểm thử: `review-browser-smoke.mjs` (thêm tại chỗ → duyệt → nháp → gửi → từ chối).

