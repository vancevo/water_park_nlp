# Bản đồ minh họa "Đầm Sen Khô" so với bản đồ cũ (OSM)

Câu hỏi: bản đồ minh họa (đẹp) có thể làm bản đồ thật mà vẫn chỉ đường đúng như
bản đồ cũ (đường OSM) không? Kết quả đo ngày 2026-10-09. Trạng thái: **thử nghiệm,
chưa dùng để dẫn đường**.

## Cách xem

Visitor web → góc dưới bên trái bản đồ: **Cũ | Mới | Chồng lớp**. Đường OSM
(màu kem, viền xanh) và tuyến dẫn đường luôn được vẽ *trên* ảnh, nên chỗ nào
lệch đều nhìn thấy. Chế độ "Chồng lớp" có thanh độ mờ.

## Đã đo gì

Sự thật để so sánh là dữ liệu OSM: hồ (relation 5445124, có đảo) và 360 điểm
đường đi bộ. Tìm phép biến đổi đồng dạng (xoay + tỉ lệ + dịch) đặt hồ OSM
trùng hồ trong ảnh nhất (`apps/visitor-web/scripts/georeference-illustrated-map/fit.py`,
chạy lại được):

| Chỉ số | Giá trị |
|---|---|
| Xoay cần thiết | ~256° (ảnh bị xoay ~100° so với hướng bắc) |
| Trùng khớp hồ (IoU) khi để hướng bắc ở trên, chỉ co giãn/dịch | 0,10 (vô dụng) |
| Trùng khớp hồ (IoU) với phép xoay tốt nhất | 0,53 (vừa phải) |
| Đường OSM rơi xuống mặt nước vẽ trong ảnh | ~11% (đúng ra ≈ 0–2%, trừ cầu tàu) |

## Kết luận

1. **Cấu trúc đúng, hướng thì lệch.** Sau khi xoay, đường trục từ cổng chính tới
   đảo, các đường quanh hồ và các lối chính của OSM khớp với đường vẽ trong ảnh.
   Nghĩa là ảnh vẽ đúng "sơ đồ" của công viên. Nhưng mũi tên "N" trong ảnh không
   phải hướng bắc thật: theo phép khớp, "Cổng Lạc Long Quân" nằm về phía **đông**,
   đường Hòa Bình về phía bắc. *Cần bạn xác nhận bằng hiểu biết thực tế.*
2. **Không khớp tuyệt đối.** Ảnh là tranh minh họa (không đúng tỉ lệ, nhiều
   chỗ bị bóp/kéo): một phép biến đổi cứng cho sai số khoảng vài chục mét ở
   nhiều nơi, một số đoạn đường OSM cắt qua hồ vẽ. Dẫn đường trên ảnh như vậy sẽ
   **vẽ tuyến lệch khỏi đường trong ảnh**.
3. **Phần ngoài ảnh.** Ảnh chỉ có khu "Khô". Khu công viên nước phía tây nam và
   một phần phía bắc của dữ liệu OSM không có trong ảnh.

## Để dùng làm bản đồ thật cần thêm gì

- **Căn chỉnh bằng điểm điều khiển** (≥ 8–10 cặp điểm: cổng, góc hồ, ngã ba, cầu
  tàu) và biến đổi phi tuyến từng vùng để sai số < ~5 m. Cần người biết công
  viên xác nhận từng cặp điểm.
- Hoặc **vẽ lại đồ thị đường đi trực tiếp lên ảnh** (tọa độ ảnh) và dẫn đường
  trong hệ ảnh; tuyến sẽ luôn nằm đúng trên đường vẽ nhưng không dùng GPS thật
  trừ khi có phép chuyển ảnh ↔ GPS.
- Xác nhận **quyền sử dụng ảnh** (nguồn, tác giả) trước khi công khai (B01).

Không đổi dữ liệu dẫn đường, API hay OpenAPI; ảnh chỉ là lớp hiển thị tùy chọn.
