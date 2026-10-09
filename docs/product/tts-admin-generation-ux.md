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
| `succeeded` | "Đã tạo xong audio AI (chỉ cho bản nháp, chưa xuất bản)", provenance; nghe thử nếu có URL, nếu không thì nói rõ bản nháp đã/chưa có audio (I01) | Tạo lại (cần transcript mới — cùng transcript + model version trả lại job cũ) |
| `failed` | "Tạo audio thất bại — <mô tả theo errorCode>" | Thử lại |
| `cancelled` | "Đã huỷ tạo audio" | Thử lại |

- Trong lúc job đang chạy (từ khi bấm tạo đến khi `succeeded`/`failed`/
  `cancelled`, kể cả khi polling tạm dừng vì lỗi mạng) nút "Lưu thuyết minh"
  và "Gửi duyệt" bị khoá kèm lý do: audio AI không được gắn vào transcript
  hoặc trạng thái workflow khác với lúc tạo. Đổi tab ngôn ngữ rồi quay lại
  vẫn tiếp tục theo dõi job trong cùng phiên trang.
- Polling tự động (0,8 s → tối đa 5 s), dừng ở trạng thái kết thúc; sau 3 lỗi
  mạng liên tiếp thì dừng và cho "Kiểm tra lại".
- Chỉ hiển thị mã lỗi ổn định (`TTS_TIMEOUT`, `TTS_AUDIO_INVALID`,
  `TTS_PROVIDER_ERROR`, `AI_FEATURE_DISABLED`, …) dưới dạng câu tiếng Việt;
  lỗi khi tạo job theo `code` của API (`NARRATION_LOCALE_DISABLED`,
  `TTS_JOB_LOCALE_MISMATCH`, `TTS_JOB_TRANSCRIPT_EMPTY`, quota
  `rate_limited`/`concurrency_limited`, HTTP 429/503); không hiện stack hay
  message nội bộ của server.
- Job `queued` quá 2 phút: ghi chú "máy chủ có thể chưa chạy worker", cho huỷ.
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

Kiểm chứng với backend thật ở I01: cả bốn mục dưới đây **vẫn mở** (xem
`docs/runbooks/frontend-i01-integration-report.md` §4 cho danh sách I02 kèm
file:line). UI giữ cách xử lý suy giảm an toàn.

- Job/narration chưa có URL audio để admin nghe lại bản nháp do AI tạo
  (`AdminNarration.audio` không có `playbackUrl`); demo dùng âm báo cục bộ.
- Narration chưa mang provenance AI (`generatedBy {provider, model,
  modelVersion, jobId}`) nên lịch sử phiên bản chưa thể gắn nhãn AI sau reload.
- Chưa có endpoint liệt kê job gần nhất của một narration. UI nhớ job đang
  chạy trong phiên trang (đổi tab vẫn theo dõi), nhưng sau khi tải lại trang
  hoặc ở trình duyệt khác thì không biết job đang chạy; backend cần từ chối
  submit khi narration còn job `queued`/`running` (RBAC/khóa phía server là
  nguồn quyết định).
- Mã lỗi 409 của create/cancel job (ví dụ narration không còn là draft, job đã
  kết thúc) chưa được tài liệu hoá trong OpenAPI; UI hiện chỉ hiển thị thông
  báo chung theo HTTP status.
