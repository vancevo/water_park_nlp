# Đường đi vẽ lại trên bản đồ chính thức (cổng 1 ở dưới)

- `dam-sen-line-duong.svg`: đường đi vẽ trên bản đồ chính thức (khung 2048×1315 = `dam-sen-map.jpg`).
- `pins.json`: đầu nhọn 54 ghim (50 số + 11.1–11.4) và màu theo chú giải bản đồ.
- `build_graph.py`: nối đường tại giao điểm, thêm nút ~15 m một nút, gắn lối vào của 50 địa điểm → `graph.json`,
  `damsen-walkways.geojson`, `damsen-pois-new.json`, `damsen-map.georef.json` (4 góc + `bearingDegrees`).
- `svg_to_geojson.py` (phép biến đổi SVG → kinh/vĩ độ) và `old-picture.georef.json` (georef ảnh minh họa cũ, đã khớp OSM).
- `scripts/import-redrawn-walkways.mjs`: nạp vào DB, **đóng** (không xoá) các cạnh OSM, chuyển 50 địa điểm sang ghim mới.

```bash
python3 data/walkways-new/build_graph.py
node scripts/import-redrawn-walkways.mjs --dry-run && node scripts/import-redrawn-walkways.mjs
node apps/admin-web/scripts/export-walk-nodes.mjs     # danh sách nút cho form admin
cp data/walkways-new/{dam-sen-map.jpg,damsen-map.georef.json,damsen-walkways.geojson} ... # xem apps/*/public
```

**Điểm chuẩn (`control-points.json`):** các vị trí đã biết toạ độ thật và đã đọc pixel trên ảnh bản đồ. `build_graph.py`
dời georeference để mỗi điểm rơi đúng toạ độ của nó (1 điểm: dời cả bản đồ; 2 điểm: dời + xoay + co giãn; từ 3 điểm: biến đổi
affine). Hiện có 1 điểm (cuối hồ nước quảng trường La Mã), nên chỉ sửa lệch tịnh tiến; thêm điểm ở xa nhau (cổng 1, góc đối
diện) để sửa cả xoay/co giãn. Sau khi đổi: `build_graph.py` → `sync_pois.py` → copy file vào `apps/*/public` → `import-redrawn-walkways.mjs`.
Ghim trên bản đồ có mũi nhọn nằm đúng toạ độ (không phải tâm ghim).

**Độ chính xác:** toạ độ là ước lượng (~3–8 m): đường được ghép vào ảnh minh họa cũ (đã khớp OSM), không đo thực địa.
Bản đồ chính thức không vẽ đúng tỉ lệ nên một phép biến đổi affine không khớp mọi nơi. 10 địa điểm
(18, 19, 20, 22, 23, 24, 25, 27, 42, 49) không có đường vẽ trong ~70 m: lối vào là điểm gần nhất trên đường. Hãy vẽ thêm đường hoặc đo bằng `/field`.
Quay lại đường OSM: xem đầu `scripts/import-redrawn-walkways.mjs`.
