# Hướng dẫn chạy demo Đầm Sen Smart Guide trên máy Windows

Bản demo chạy hoàn toàn trên máy của bạn: bản đồ và danh sách địa điểm, tìm
kiếm (theo chữ, theo hướng, theo ý nghĩa), thuyết minh có **giọng đọc AI miễn
phí (Piper)** và trang quản trị để tạo/duyệt audio AI. Không cần API key, không
tốn phí.

> Đây là bản demo phục vụ học tập (phi thương mại). Dữ liệu 5 địa điểm là dữ
> liệu giả lập, không phải dữ liệu thật của Đầm Sen.

## 1. Cài 3 phần mềm (chỉ một lần)

| Phần mềm           | Tải ở đâu                                       | Lưu ý khi cài                                                                                        |
| ------------------ | ----------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| **Node.js 24 LTS** | https://nodejs.org                              | Bấm Next đến hết là được                                                                             |
| **Docker Desktop** | https://www.docker.com/products/docker-desktop/ | Cài xong khởi động lại máy nếu được hỏi. Mở Docker Desktop, đợi góc dưới trái báo **Engine running** |
| **Python 3.12**    | https://www.python.org/downloads/               | Ở màn hình đầu tiên **tick ô "Add python.exe to PATH"**                                              |

Máy nên có RAM 8 GB trở lên và còn trống khoảng **10 GB** ổ đĩa.

## 2. Cài đặt demo (chỉ một lần, 15–30 phút)

1. Mở **Docker Desktop** và đợi báo **Engine running**.
2. Mở thư mục dự án `water_park_nlp` → thư mục **`demo`**.
3. Bấm đúp **`1-CAI-DAT-LAN-DAU.cmd`**.
   - Nếu Windows hiện "Windows protected your PC": bấm **More info** →
     **Run anyway**.
4. Cửa sổ đen sẽ chạy lần lượt 9 bước: cài thư viện, khởi động database, cài
   Piper, tải 3 giọng đọc (vi/en/fr), build ứng dụng, tải model tìm kiếm
   **bge-m3** (~570 MB) rồi tự hiệu chỉnh tìm kiếm.
5. Khi thấy **"Cài đặt xong"**, nhấn phím bất kỳ để đóng.

Nếu có lỗi, cửa sổ sẽ ghi rõ cần làm gì (ví dụ "Docker chưa chạy"). Sửa xong
thì bấm đúp lại file đó — các bước đã xong sẽ được bỏ qua.

## 3. Chạy demo (mỗi lần trình bày, ~1–2 phút)

1. Mở **Docker Desktop**, đợi **Engine running**.
2. Bấm đúp **`demo\2-CHAY-DEMO.cmd`**.
3. Đợi dòng **"DEMO ĐANG CHẠY"**. Trình duyệt tự mở 2 trang:
   - **Web khách tham quan:** http://localhost:3002
   - **Web quản trị:** http://localhost:3001 — đăng nhập ở khung bên trái:
     - Email: `admin@damsen.local`
     - Mật khẩu: `DamSen-Demo-2026`
4. **Giữ cửa sổ đen mở** trong suốt buổi demo.

Lần chạy đầu tiên, demo tự tạo audio AI cho 5 địa điểm × 2 ngôn ngữ (khoảng 1
phút), nên khách tham quan mở ra là nghe được ngay.

## 4. Dừng demo

- Bấm vào cửa sổ đen rồi nhấn **Ctrl + C**, hoặc
- Bấm đúp **`demo\3-DUNG-DEMO.cmd`**.

## 5. Gợi ý kịch bản trình bày cho giáo viên (~5 phút)

1. **Web khách** (http://localhost:3002): chọn **Sân Khấu Gió** → bảng thuyết
   minh có nhãn **"Giọng đọc do AI tạo"** → bấm ▶ để nghe. Đổi ngôn ngữ thuyết
   minh sang English để nghe giọng tiếng Anh.
2. **Tìm kiếm:** gõ vào ô tìm kiếm:
   - `vuon cau vong` (không dấu) → vẫn ra **Vườn Cầu Vồng**.
   - `xa nhất về phía đông` → ra các điểm ở phía đông bản đồ.
   - `tôi muốn xem biểu diễn âm nhạc` → tìm theo **ý nghĩa** (embedding bge-m3)
     dù tên địa điểm không có chữ "âm nhạc". Lúc cài đặt, bước 8 có in
     "bắt thêm được x/10 câu hỏi theo ý nghĩa" — đó là số câu kiểu này model
     trên máy bạn tìm được.
3. **Dẫn đường:** chọn một địa điểm → **Dẫn đường từ vị trí của tôi**, hoặc
   dùng **Người mô phỏng** để xem nhân vật đi trên bản đồ.
4. **Web quản trị** (http://localhost:3001): đăng nhập → bấm **Sửa** ở một
   địa điểm → phần thuyết minh → **Tạo lại audio AI** → xem trạng thái chạy →
   nghe thử bản nháp → **Gửi duyệt** → **Duyệt xuất bản**. Nhấn mạnh: AI chỉ
   tạo bản nháp, **con người duyệt** mới được xuất bản.

## 6. Khi gặp sự cố

| Hiện tượng                                      | Cách xử lý                                                                                     |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| "Docker chưa chạy"                              | Mở Docker Desktop, đợi **Engine running**, chạy lại                                            |
| "Cổng 3000/3001/3002 đang bị chiếm"             | Bấm `3-DUNG-DEMO.cmd`, rồi chạy lại `2-CHAY-DEMO.cmd`. Vẫn lỗi thì khởi động lại máy           |
| Windows Firewall hỏi "Allow access" cho Node.js | Bấm **Allow** (hoặc Cancel — demo trên máy bạn vẫn chạy)                                       |
| Tìm theo ý nghĩa chậm ở câu đầu                 | Bình thường — model đang "khởi động", các câu sau nhanh hơn                                    |
| Không nghe được audio                           | Đợi vài giây sau dòng "DEMO ĐANG CHẠY" rồi tải lại trang (F5)                                  |
| Lỗi khác                                        | Mở thư mục `.demo\logs` (trong thư mục dự án) — mỗi phần có một file log, gửi file đó cho nhóm |

Muốn cài lại từ đầu: dừng demo, xoá thư mục `.demo` trong thư mục dự án, rồi
chạy lại `1-CAI-DAT-LAN-DAU.cmd`.

## 7. Bên trong demo có gì (để trả lời câu hỏi)

| Thành phần           | Công nghệ                                                                                          | Cổng              |
| -------------------- | -------------------------------------------------------------------------------------------------- | ----------------- |
| Web khách tham quan  | Next.js                                                                                            | 3002              |
| Web quản trị         | Next.js                                                                                            | 3001              |
| API                  | NestJS                                                                                             | 3000              |
| Worker tạo giọng đọc | Node.js + **Piper** (giọng `vi_VN-vais1000-medium`, `en_US-ljspeech-medium`, `fr_FR-siwis-medium`) | 9464 (`/metrics`) |
| Tìm kiếm ngữ nghĩa   | **BAAI/bge-m3** (miễn phí, chạy trên CPU)                                                          | 8091              |
| Database             | PostgreSQL + PostGIS + pgRouting + pgvector (Docker)                                               | 64321             |
| Lưu audio            | MinIO (Docker)                                                                                     | 9000              |

Lệnh tương đương cho người dùng dòng lệnh: `node scripts/demo/demo.mjs
setup|start|stop|status`.
