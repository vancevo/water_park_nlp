# 50 địa điểm của bản đồ Đầm Sen

`damsen-pois.json`: 50 địa điểm theo sơ đồ có đánh số (số, tên VI/EN, loại, vị trí).

- **Vị trí** = đầu nhọn của từng ghim số trên bản đồ minh họa (`apps/visitor-web/public/maps/damsen-map.jpg`, bản đồ chính thức, cổng 1 ở dưới),
  đổi sang kinh/vĩ độ bằng georeference của bản đồ đó (xem `data/walkways-new/`). Đây là **ước lượng**
  (sai số vài mét tới hàng chục mét do bản đồ không đúng tỉ lệ), **chưa kiểm chứng thực địa**. Dùng `/field` để đo lại.
  `pin` = màu ghim theo chú giải (trắng tự do, xanh mọi đối tượng, tím 1–1,2 m, hồng 1–1,4 m, đỏ >1,4 m, vàng cổng/vé).
- **Tên và số** theo chú giải bản đồ do nhóm cung cấp; tên tiếng Anh do nhóm dự án dịch.
- **Loại** chọn theo tên và màu ghim (đỏ = mạo hiểm, hồng = thiếu nhi, vàng = cổng/quầy vé…); sửa được trong admin.

```bash
python3 data/pois/validate.py                       # kiểm tra file
npm run seed:park                                  # đồ thị đường đi + 50 địa điểm (cần API chạy, ADMIN_PASSWORD)
ADMIN_PASSWORD=... node scripts/import-pois.mjs --dry-run
ADMIN_PASSWORD=... node scripts/import-pois.mjs    # tạo + gửi duyệt + duyệt qua API admin
```

Import chạy lại được (bỏ qua slug đã có). `--no-publish` để giữ ở trạng thái nháp.
Lối vào chính của mỗi địa điểm được gắn vào điểm đường đi bộ OSM gần nhất; 9 điểm cách đường > 75 m
(ví dụ cổng 1A, đài nhạc nước) sẽ chưa chỉ đường được tới nơi cho tới khi chỉnh lối vào ngoài thực địa.
