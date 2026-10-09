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

## Bản đồ chính thức "CVVH Đầm Sen" (khớp bằng 2 hồ, affine)

Ảnh sơ đồ chính thức của công viên là tác phẩm của bên thứ ba (quyền sử dụng
chưa được xác nhận — B01), nên **ảnh không nằm trong git**: đặt tại
`apps/visitor-web/public/maps/local/damsen-official.png` (đã gitignore). Chỉ có
số liệu căn chỉnh được commit (`public/maps/damsen-official.georef.json`). Trong
app, khi có file này thì ô "Ảnh" cho chọn "Chính thức (nội bộ)".

Khớp bằng hồ chính (có đảo) và hồ Khu B của OSM, phép biến đổi affine
(`fit_official.py`, chạy lại được):

| Chỉ số | Chỉ xoay + co giãn đều | Affine |
|---|---|---|
| Trùng khớp hồ chính (IoU) | 0,48 | **0,83** |
| Trùng khớp hồ Khu B (IoU) | 0,32 | 0,35 (nhận dạng hồ bằng màu, kém ổn định) |
| Đường OSM rơi xuống nước vẽ | — | 4,7% (chủ yếu cầu Cửu Khúc và đường ven hồ) |
| Tỉ lệ | — | ~0,66–0,68 m/pixel |

- Hướng giống ảnh minh họa: **phần "trên" của bản đồ là hướng tây** (Kênh Tân Hóa
  nằm phía tây công viên trong OSM). Hai bản đồ và OSM nhất quán.
- Bằng mắt: đường ven hồ, trục từ Cổng số 1 lên đảo Sân khấu Ngôi Sao và các lối
  ở Khu B khớp với đường vẽ; vùng khu trò chơi phía đông ít đường OSM hơn.
- **Chưa chứng minh được độ chính xác tuyệt đối.** Thử đối chiếu 3 cổng: cổng
  nhà hàng Thủy Tạ khớp trong ~60–80 m, nhưng Cổng số 1 và 1A lệch ~190 m so với
  nút `barrier=gate` gần nhất — OSM không đặt tên các cổng nên có thể là cổng khác,
  hoặc phép khớp chưa đủ chính xác ở đó. Cần điểm đối chiếu thực địa (GPS tại cổng,
  cầu, ngã ba) để chốt; không dùng để dẫn đường trước khi làm việc này.

## Minh họa 2 (ảnh "Đầm Sen Khô" thứ hai) — khớp được nhưng độ tin cậy thấp

Ảnh vẽ cả viền công viên (có thùy tây bắc, thùy tây nam) trên nền xanh nhạt, nên
khớp bằng **viền công viên + hồ** so với ranh giới OSM (way 32735046) và hồ
(`fit_silhouette.py`, chạy lại được). Đã thử 3 cách:

| Cách | Kết quả |
|---|---|
| Viền + hồ, affine (cách chọn) | xoay ~300°; trùng viền 0,58; trùng hồ **0,31**; 0,9% đường OSM rơi xuống nước; 72% đường OSM nằm trong viền ảnh |
| Chỉ ưu tiên hồ | trùng hồ 0,33 nhưng trùng viền chỉ 0,50 |
| Qua bản đồ chính thức bằng 7 điểm chung (cổng, đảo, đài phun, cầu, ao) | sai số trung bình ~120 m, vẽ OSM co nhỏ một nửa → bỏ |

Kết luận: ảnh này **không phải bản vẽ tỉ lệ thật** — hồ là một hình tam giác lớn
cộng một hồ phía tây tách riêng, vị trí các cổng so với hồ khác bản chính thức, thùy
tây nam là khu vườn không có ao như trong OSM. Nó nhìn đẹp nhưng không có phép
biến đổi đơn giản nào khớp tốt (hồ chỉ trùng ~31%, kém ảnh minh họa 1 là 53% và
bản chính thức là 83%). Trong app nó được gắn nhãn "Minh họa 2 (độ tin cậy thấp)".

Khuyến nghị: dùng ảnh này chỉ để xem. Nếu muốn dùng thật thì cần vẽ lại cho đúng
bố cục (hoặc nắn từng vùng bằng nhiều điểm đối chiếu thực địa — ảnh sẽ bị biến
dạng nhiều); bản chính thức vẫn là bản khớp tốt nhất cho tới nay.

