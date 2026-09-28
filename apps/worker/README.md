# Worker

Worker chứa các background job như embedding, TTS và media processing.

## Semantic embedding cho POI

Embedding là vector số biểu diễn ý nghĩa tương đối của văn bản. Hai câu không
trùng từ khóa nhưng có ý gần nhau có thể có vector gần nhau; PostgreSQL/pgvector
dùng cosine distance để lấy candidate cho semantic search. Đây là một tín hiệu
retrieval, không phải câu trả lời hoặc bằng chứng rằng kết quả “hiểu” nội dung.

Pipeline hiện có:

1. Đọc POI `published` và từng bản dịch `vi`/`en`.
2. Tạo document ổn định theo schema `poi-search-document/v1`.
3. Tính SHA-256; bỏ qua document không đổi trong cùng model/version.
4. Embed theo batch, kiểm tra đúng 1024 chiều, rồi upsert idempotent vào
   `semantic_embeddings`.
5. Giữ embedding của các model version khác nhau để benchmark hoặc rollback.

`EmbeddingService` nhận `EmbeddingProvider` và `EmbeddingRepository` qua
constructor. Vì vậy queue/CLI có thể composition `PostgresEmbeddingRepository`
với provider thực tế mà không đưa SDK vendor vào domain. `force: true` dùng khi
cần re-index toàn bộ; retry một batch là an toàn nhờ unique key và upsert.

Test chỉ dùng provider giả xác định để kiểm tra orchestration. Vector giả **không
có chất lượng semantic** và tuyệt đối không nên dùng cho production.

## Gắn provider production trong tương lai

Chưa chọn model trước khi benchmark tập truy vấn Việt/Anh thực tế. Candidate
ban đầu là `BAAI/bge-m3` hoặc multilingual E5. Adapter cần:

- implement `EmbeddingProvider` với tên model, immutable model version và output
  đúng 1024 chiều;
- áp dụng query/document prefix theo tài liệu chính thức của model (đặc biệt E5);
- batch request, timeout/rate-limit ở adapter và không log nội dung người dùng;
- pin revision model, benchmark recall/nDCG cùng lexical search trước rollout;
- chạy model mới bằng `modelVersion` mới, sau đó chuyển cấu hình search khi đạt
  ngưỡng thay vì ghi đè phiên bản cũ.

Không gọi paid/external API trong test. Nếu model được self-host, adapter vẫn giữ
contract tương tự để service không đổi.

```bash
source ~/.nvm/nvm.sh && nvm use 24
npm test --workspace @damsen/worker
npm run typecheck --workspace @damsen/worker
npm run build --workspace @damsen/worker
```
