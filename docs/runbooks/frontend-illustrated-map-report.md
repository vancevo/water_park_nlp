# Bản đồ minh họa "Đầm Sen" — kết quả khớp với đường OSM

Trạng thái: **đã chốt** dùng một ảnh (`apps/visitor-web/public/maps/damsen-map.jpg`) làm
bản đồ **Mới**; bản đồ **Cũ** (OSM) vẫn có để so sánh. Nút chuyển nằm phía trên nút zoom.

## Cách khớp

Ảnh vẽ sẵn mạng đường đi bộ dạng nét be. `fit_paths.py` trích mạng đường đó, rồi tìm
phép affine (xoay, tỉ lệ, nghiêng, dịch) đặt đường OSM (`damsen-osm-walkways.geojson`)
lên đúng các nét vẽ, bằng cách giảm khoảng cách trung bình từ mỗi điểm OSM tới nét vẽ
gần nhất. Chạy lại:

```bash
python3 apps/visitor-web/scripts/georeference-illustrated-map/fit_paths.py \
  --image apps/visitor-web/public/maps/damsen-map.jpg \
  --out apps/visitor-web/public/maps/damsen-map.georef.json \
  --path-color 248,216,184 --tolerance 32
```

| Chỉ số | Giá trị |
|---|---|
| Sai số trung bình đường OSM ↔ đường vẽ | **~0,8 m** |
| Điểm đường OSM trong ≤ 3 pixel (nửa độ phân giải) | **94%** (xuất phát từ ước lượng khung bao: 83%) |
| Góc xoay | −0,4° — ảnh vẽ **hướng bắc ở trên** |
| Tỉ lệ | ~0,77 m/pixel, gần như đều (0,78 × 0,76) |

Khởi tạo từ phép biến đổi của một ảnh cùng bố cục khác (`--init-from`) cho kết quả trùng
(các góc cách nhau ≤ 1,5 m), nên kết quả không phụ thuộc điểm xuất phát.

## Giới hạn (đọc trước khi tin)

- **Chỉ chứng minh ảnh khớp với đường OSM**, không chứng minh OSM đúng ngoài đời — dữ liệu
  OSM chưa được khảo sát thực địa (B01). Cần vài điểm đo GPS tại cổng và ngã ba lớn.
- Kiểm tra độc lập bằng hồ chỉ cho ~38% (bộ lọc màu không tính sen/bèo/bọt phun là
  nước); bằng mắt viền hồ và ao tây nam của OSM bám đúng hồ vẽ, hòn đảo OSM lệch vài chục
  mét. Phần ngoài mạng đường (nhà, cây, hồ) là minh họa.
- **Quyền sử dụng ảnh chưa được xác nhận** (B01).

## Các ảnh đã thử và bỏ

Trong quá trình chọn đã thử 4 ảnh khác, kể cả bản đồ chính thức của công viên (khớp được
nhưng là tài liệu của bên thứ ba nên chưa dùng) và hai ảnh minh họa không đúng tỉ lệ (hồ
trùng 0,31–0,53 so với OSM). Không còn nằm trong repo. Điều đáng nhớ: các ảnh đó đều bị
xoay ~100° so với hướng bắc; chỉ ảnh chốt vẽ hướng bắc ở trên.
