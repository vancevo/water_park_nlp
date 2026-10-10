# 50 địa điểm của bản đồ Đầm Sen

`damsen-pois.json`: 50 địa điểm theo sơ đồ có đánh số (số, tên VI/EN, loại, vị trí).

- **Vị trí** = đầu nhọn của từng ghim số trên bản đồ minh họa (`apps/visitor-web/public/maps/damsen-map.jpg`),
  đổi sang kinh/vĩ độ bằng georeference của bản đồ đó. Đây là **ước lượng** (sai số cỡ vài mét tới
  ~10 m do vẽ ghim và độ khớp ảnh với OSM), **chưa kiểm chứng thực địa**. Dùng `/field` để đo lại.
- **Tên và số** theo chú giải bản đồ do nhóm cung cấp; tên tiếng Anh do nhóm dự án dịch.
- **Loại** chọn theo tên và màu ghim (đỏ = mạo hiểm, hồng = thiếu nhi, vàng = cổng/quầy vé…); sửa được trong admin.

```bash
python3 data/pois/validate.py                       # kiểm tra file
node scripts/import-osm-walkways.mjs               # một lần: đường đi bộ OSM vào đồ thị
ADMIN_PASSWORD=... node scripts/import-pois.mjs --dry-run
ADMIN_PASSWORD=... node scripts/import-pois.mjs    # tạo + gửi duyệt + duyệt qua API admin
```

Import chạy lại được (bỏ qua slug đã có). `--no-publish` để giữ ở trạng thái nháp.
Lối vào chính của mỗi địa điểm được gắn vào điểm đường đi bộ OSM gần nhất; 9 điểm cách đường > 75 m
(ví dụ cổng 1A, đài nhạc nước) sẽ chưa chỉ đường được tới nơi cho tới khi chỉnh lối vào ngoài thực địa.
