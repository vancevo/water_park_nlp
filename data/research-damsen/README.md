# Dam Sen research dataset

Dataset này dùng cho học tập và demo nội bộ. Nó không phải bản đồ chính thức và
không được dùng để dẫn đường ngoài thực địa.

- Tên và category là dữ kiện tham khảo từ các trang công khai chính thức được
  ghi trong `sources.json`.
- Mô tả Việt/Anh được viết mới, không sao chép nội dung quảng bá.
- Không tải lại ảnh, audio, logo hoặc sơ đồ của Đầm Sen.
- Toàn bộ tọa độ, entrance và walkway graph được sinh giả lập có tính xác định.
- Mọi POI mặc định là `draft`, `field_verified=false` và
  `navigation_use=prohibited_until_field_verified`.

Sinh và kiểm tra lại dataset:

```bash
python3 data/research-damsen/generate.py
python3 data/research-damsen/validate.py
```

Muốn chuyển một POI sang dữ liệu thật phải khảo sát tọa độ/entrance/lối đi, ghi
người kiểm tra + ngày kiểm tra và duyệt nội dung trong admin. Không được đổi cờ
chỉ dựa trên Google Maps, ảnh sơ đồ hoặc ước lượng từ dataset này.
