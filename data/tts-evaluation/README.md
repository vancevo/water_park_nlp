# TTS evaluation corpus và pronunciation assets (AI01 / T06)

Bộ dữ liệu **chỉ dùng để đánh giá** TTS thuyết minh cho VI, EN và locale thử
nghiệm thứ ba FR. Toàn bộ câu là **văn bản gốc, tổng hợp (synthetic)** viết cho
dự án; nội dung là hư cấu (giờ mở cửa, giá vé, khoảng cách, ngày tháng chỉ để
minh hoạ, không mô tả công viên thật). Không có audio, giọng người thật hay dữ
liệu cá nhân trong thư mục này.

## Nội dung

| File | Vai trò |
|---|---|
| `manifest.json` | Dataset id/version, nguồn + license từng nguồn, license/sources/sha256 từng file, chính sách train/eval |
| `corpus/{vi,en,fr}.json` | Câu đánh giá theo nhóm: `poi-name`, `place-name`, `number-date`, `abbreviation`, `code-switch`, `punctuation`, `long`, `safety` |
| `lexicon/pronunciation.json` | Pronunciation dictionary có version: tên POI, địa danh, viết tắt, từ code-switch; IPA gần đúng (VI giọng Nam), `spokenForm`, `reviewStatus` |
| `review/blind-review-form.json` | Phiếu đánh giá mù 1–5 (natural, intelligibility, pronunciation, pace, suitability) + check lỗi tên/nội dung |
| `thresholds.json` | Release gate **chốt trước khi xem kết quả** (MOS, lỗi tên POI, automated checks, p95/RTF) |
| `reports/report.schema.json` | Schema báo cáo = superset `BenchmarkReport` của worker + automated checks, human ratings, gate |
| `reports/fixtures/example-report.json` | Báo cáo **giả lập** (số liệu bịa) cho test/UI mock, gồm 1 locale pass và 1 locale fail gate |
| `validate.py`, `test_validate.py` | Validator + unit test, chỉ dùng thư viện chuẩn Python |

Câu thuộc nhóm `number-date`/`abbreviation` có `expectedNormalized` (dạng đọc
thành chữ) để kiểm tra text normalization. `lexiconRefs` trỏ tới entry trong
lexicon. Mỗi câu có `split: "eval"`, `sourceId` và `synthetic`.

## Lệnh

```bash
python3 data/tts-evaluation/validate.py
python3 data/tts-evaluation/test_validate.py
# Sau khi sửa dữ liệu và đã review nội dung/quyền:
python3 data/tts-evaluation/validate.py --update-checksums
# Xuất đúng shape worker benchmark đang đọc ({schema, sentences[id,locale,category,text]}):
python3 data/tts-evaluation/validate.py --export-benchmark /tmp/tts-benchmark-sentences.json [--locale vi]
```

Validator từ chối: thiếu license/origin/rightsHolder của nguồn; file thiếu
license/sourceIds/sha256 hoặc checksum lệch; file JSON không có trong manifest;
câu thiếu/không rõ `sourceId`; `split` khác `eval`; id trùng; category lạ; thiếu
độ phủ tối thiểu mỗi nhóm; `expectedNormalized` còn chữ số; text giống email,
số điện thoại hoặc URL; lexicon ref không tồn tại; báo cáo chứa transcript/audio,
`modelVersion` không pin, số đếm lệch, sample sai locale, lỗi không có mã
`TTS_*` ổn định, hoặc `gate` không khớp `thresholds.json`.

## Quyền sử dụng và tách train/eval

- Nguồn `tu-original-2026` và `fixture-poi-names` là văn bản gốc của dự án
  (`LicenseRef-DamSen-Project-Original`); chủ dự án cần chốt license công khai
  (ví dụ CC0-1.0) trước khi phát hành ra ngoài.
- `public-place-names` chỉ dùng **tên** địa danh (sự kiện), không chép mô tả,
  ảnh hay dữ liệu bản đồ. Tên/nội dung POI thật vẫn bị chặn bởi B01.
- `trainingUse: forbidden`: không dùng bộ này để train/fine-tune. Dữ liệu train
  sau này (AI06) phải là dataset riêng có consent/license và không trùng câu.
- Lexicon đều ở trạng thái `needs_native_review`; cần người bản ngữ duyệt
  trước khi dùng làm override phát âm production.

## Tích hợp (I03)

Backend (Công) chạy `--export-benchmark` rồi đưa file vào benchmark runner của
worker thay cho fixture nhỏ `config/tts-benchmark-sentences.json`; báo cáo cuối
thêm `corpus`, `automatedChecks`, `humanRatings` và `gate` theo
`reports/report.schema.json`. Không thay đổi file trong `config/` từ luồng này.

Kết quả I03: `reports/fixtures/i03-pipeline-check-report.json` — toàn bộ 64 câu
qua benchmark worker với provider CLI **âm sine giả** (Piper bị chặn), kèm
automated checks đo trên file WAV và gate theo `thresholds.json`. Đây là kiểm
tra pipeline, **không phải** benchmark chất lượng; mọi gate fail với
`missing-human-ratings` cho tới khi có provider thật + blind review. Chi tiết:
`docs/runbooks/frontend-i03-acceptance-report.md` §3.4.
