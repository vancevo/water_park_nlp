# Dam Sen visitor web

Responsive web app cho actor `Guest/VISITOR`. App dùng lại typed API client và
backend hiện có cho POI, search, auth, narration và routing.

```bash
nvm use 24
npm run dev:api
npm run dev:visitor
```

- Visitor web: `http://localhost:3002`
- Admin web: `http://localhost:3001`
- API: `http://localhost:3000`

GPS dùng Web Geolocation API và chỉ được yêu cầu sau khi người dùng bấm nút.
`localhost` được trình duyệt coi là secure context; production phải dùng HTTPS.
MapLibre ưu tiên nền raster cấu hình bằng `VITE_MAP_TILE_URL` và
`VITE_MAP_TILE_ATTRIBUTION` trong `.env.local`. Next.js ánh xạ hai biến này sang
client ở build time; nếu không cấu hình, app tự dùng sơ đồ nghiên cứu cục bộ.
Sao chép `.env.example` thành `.env.local`, điền API key và khởi động lại dev
server. `.env.local` đã bị Git bỏ qua.

Với Geoapify Free, attribution trên bản đồ phải bao gồm Geoapify và
OpenStreetMap. API key chạy trên trình duyệt nên không thể là secret tuyệt đối;
cần giới hạn allowed origins trong Geoapify dashboard trước khi deploy.

Visitor dev hiện hiển thị 5 POI tham khảo có vị trí từ OpenStreetMap hoặc nguồn
tọa độ công khai, cùng snapshot 54 lối đi OSM. Đây không phải bản đồ chính thức:
tọa độ, lối vào, tình trạng mở cửa và khả năng tiếp cận vẫn cần kiểm tra thực
địa trước khi dùng để dẫn đường thật.

## Mô phỏng người đi bộ

1. Bấm **Đặt người trên bản đồ**, sau đó click vào một lối đi trong công viên.
2. Chọn POI và bấm **Dẫn đường từ người mô phỏng**.
3. Thẻ POI tự đóng và mascot indie tự đi hết geometry của tuyến trong 5 giây;
   quãng đường mỗi frame được tính từ tổng chiều dài tuyến và thời gian đã trôi.
4. Spritesheet 6 frame tạo chu kỳ bước chân trong lúc marker di chuyển.
5. Khi đến đích, dialog thuyết minh tự mở và Web Speech TTS đọc transcript đã
   được duyệt. Có thể phát lại hoặc dừng đọc trong dialog.

Mô phỏng chỉ nằm trong state của tab trình duyệt, không thay đổi GPS thật và
không được gửi lên backend như lịch sử vị trí.
Production có thể dùng `NEXT_PUBLIC_MAP_STYLE_URL` để thay toàn bộ style sau khi
hoàn tất kiểm tra quyền/provider.

Session user chỉ nằm trong `sessionStorage`. Refresh-token cookie/rotation và
offline service worker chưa thuộc bản web MVP hiện tại.

## Ngôn ngữ thuyết minh

Nút VI/EN đổi toàn bộ chữ trên giao diện (từ điển `lib/ui-text.ts`, thiếu khóa ở một
ngôn ngữ là lỗi biên dịch), tên/mô tả địa điểm (qua API `locale`), `<html lang>` và
tiêu đề trang; lựa chọn được nhớ trong localStorage. Nội dung từ API (bước chỉ đường,
thông báo lỗi của server) không được dịch ở client.

Ngôn ngữ thuyết minh độc lập với ngôn ngữ giao diện VI/EN: danh sách lấy từ
`GET /v1/narration-locales`, lựa chọn được nhớ trong `localStorage`
(`damsen.visitor.narrationLocale.v1`), có thông báo khi API trả bản fallback,
audio đã xuất bản được ưu tiên hơn Web Speech và Web Speech dùng `speechTag`.
`NEXT_PUBLIC_NARRATION_DATA_MODE=api|demo` (mặc định `api`, đã kiểm với backend
thật ở I01: locale thêm bằng config như FR tự xuất hiện). `demo` dùng fixture
VI/EN/FR (VI có âm báo demo, FR rơi về EN). Xem
`docs/runbooks/frontend-narration-locales-tts.md`.

## Bản đồ minh họa (Cũ / Mới)

Nút nhỏ phía trên nút zoom của bản đồ chuyển giữa **Cũ** (nền OSM + đường đi bộ) và
**Mới** (ảnh minh họa `public/maps/damsen-map.jpg`, mặc định). Đường OSM và tuyến dẫn
đường luôn được vẽ trên ảnh. Các góc ảnh nằm trong `damsen-map.georef.json`, tính bằng
`scripts/georeference-illustrated-map/fit_paths.py` (đường vẽ trong ảnh được khớp với
đường OSM: sai số trung bình ~0,8 m, hướng bắc ở trên). Điều này chứng minh ảnh khớp
với OSM, không chứng minh OSM đúng thực địa. Nếu ảnh không tải được, app dùng bản
đồ cũ. Xem `docs/runbooks/frontend-illustrated-map-report.md`.
