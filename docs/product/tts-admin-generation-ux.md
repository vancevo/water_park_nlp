# TTS — UX tạo audio AI và chọn ngôn ngữ thuyết minh

Tài liệu sản phẩm cho T02–T04 (UI của T25C, T25D và AI04). Contract dữ liệu:
contract v1 trong `docs/plans/CONG_TU_WORK_SPLIT.md`; vận hành:
`docs/runbooks/frontend-narration-locales-tts.md`.

## Nguyên tắc

1. **AI không bao giờ tự xuất bản.** Audio AI chỉ gắn vào bản nháp (draft hoặc
   bản bị từ chối đang sửa). Gửi duyệt do editor bấm; chỉ reviewer xuất bản.
2. **Luôn ghi nhãn.** Mọi job và bản nghe thử hiển thị huy hiệu
   "AI-generated" cùng provider, model và modelVersion (provenance).
3. **Audio phải khớp transcript đã lưu.** Chỉ tạo khi transcript đã lưu và
   không có thay đổi chưa lưu; sửa transcript sau khi tạo sẽ hiện cảnh báo
   "audio không khớp".
4. **Ngôn ngữ thuyết minh độc lập với ngôn ngữ giao diện.** Giao diện và nội
   dung POI vẫn là VI/EN; danh sách thuyết minh đến từ catalog cấu hình.

## Admin — tab ngôn ngữ (T02)

- Tab lấy từ catalog theo đúng thứ tự cấu hình, hiển thị tên bản ngữ, mã và
  trạng thái bản mới nhất (Nháp, Chờ duyệt, Đã xuất bản, …, Chưa có).
- Trạng thái: đang tải; lỗi + thử lại; catalog rỗng; chưa đăng nhập (tab khoá).
- Locale bị tắt: biến mất sau reload; nếu POI còn bản ở locale đó, hiện ghi
  chú "đang tắt — dữ liệu được giữ".
- Mỗi tab có gợi ý ngôn ngữ dự phòng mà khách sẽ nghe khi chưa có bản xuất bản.

## Admin — tạo audio AI (T04)

| Trạng thái job | Hiển thị | Hành động |
|---|---|---|
| (chưa có) | Nút "Tạo audio AI" (khoá + lý do nếu chưa đủ điều kiện) | Tạo |
| `queued` | "Đang chờ xử lý", bước 1/3 | Huỷ |
| `running` | "Đang tạo audio", bước 2/3 | Huỷ |
| `succeeded` | "Đã tạo xong — audio được gắn vào bản nháp", nghe thử + provenance | Tạo lại |
| `failed` | "Tạo audio thất bại — <mô tả theo errorCode>" | Thử lại |
| `cancelled` | "Đã huỷ tạo audio" | Thử lại |

- Polling tự động (0,8 s → tối đa 5 s), dừng ở trạng thái kết thúc; sau 3 lỗi
  mạng liên tiếp thì dừng và cho "Kiểm tra lại".
- Chỉ hiển thị mã lỗi ổn định (`TTS_TIMEOUT`, `TTS_AUDIO_INVALID`,
  `TTS_PROVIDER_ERROR`, …) dưới dạng câu tiếng Việt; không hiện stack hay nội
  dung nội bộ.
- Quyền hiển thị (UI; backend RBAC là nguồn quyết định): VISITOR không thấy;
  REVIEWER thấy khu vực nhưng không tạo; EDITOR/ADMIN tạo cho bản draft/rejected.

## Visitor — chọn ngôn ngữ thuyết minh (T03)

- `<select>` "Ngôn ngữ thuyết minh" trong thẻ POI; lựa chọn được nhớ trên thiết
  bị (localStorage, chỉ lưu mã ngôn ngữ). Lần đầu: ngôn ngữ giao diện nếu có
  trong catalog, nếu không thì mặc định của catalog.
- Khi API trả bản ngôn ngữ khác (fallback) hiện thông báo rõ: "Chưa có thuyết
  minh Français; đang hiển thị bản English."
- Audio thu sẵn/đã xuất bản được ưu tiên; nếu không có thì dùng Web Speech với
  `speechTag` của catalog. Nếu thiết bị không có giọng đúng ngôn ngữ, không đọc
  bằng giọng sai mà báo cho khách; transcript luôn hiển thị.

## Mobile (T05)

Theo ADR 0006 không thêm màn hình mới; chỉ đảm bảo transport nhận mọi mã BCP 47.

## Khoảng trống contract (đề xuất cho Công, không tự sửa)

- Job/narration chưa có URL audio để admin nghe lại bản nháp do AI tạo
  (`AdminNarration.audio` không có `playbackUrl`); demo dùng âm báo cục bộ.
- Narration chưa mang provenance AI (`generatedBy {provider, model,
  modelVersion, jobId}`) nên lịch sử phiên bản chưa thể gắn nhãn AI sau reload.
- Chưa có endpoint liệt kê job gần nhất của một narration để tiếp tục theo dõi
  sau khi tải lại trang hoặc đổi tab.
