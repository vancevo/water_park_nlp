# Roadmap AI, TTS và huấn luyện model

## 1. Kết quả cần đạt

Dự án dùng AI ở hai năng lực có giá trị trực tiếp:

1. **Thuyết minh đa ngôn ngữ:** tạo bản nháp audio từ transcript đã duyệt, sau
   đó editor nghe, sửa và reviewer mới được publish.
2. **Tìm kiếm ngữ nghĩa:** embedding đa ngôn ngữ kết hợp lexical, vị trí và giờ
   mở cửa; có benchmark và feature flag để quay về lexical.

AI không tự xuất bản nội dung. Không clone giọng người thật nếu chưa có consent
bằng văn bản và quyền sử dụng rõ ràng. Không huấn luyện từ đầu ở giai đoạn MVP;
ưu tiên model pretrained, benchmark, rồi mới quyết định fine-tune.

## 2. Dự án đang có và còn thiếu

### Có thể tái sử dụng

- Workflow narration draft → review → publish, transcript, audio metadata và
  signed playback.
- Worker pattern có dependency injection, retry batch và idempotent write trong
  embedding pipeline.
- PostgreSQL/pgvector, schema embedding 1024 chiều và HNSW index.
- Search evaluation 50 query VI/EN với Recall@10, MRR và nDCG@10.
- Object-storage abstraction và validation MIME/size/hash.

### Khoảng trống phải xử lý

- Chưa có `TtsProvider`, job queue/CLI tạo audio hoặc provider thực tế.
- Chưa có model registry, artifact manifest, checksum và cách rollback model.
- Chưa có corpus narration chuẩn, license manifest, voice consent hoặc data card.
- Chưa có text normalization và pronunciation dictionary cho tên riêng Đầm Sen,
  chữ viết tắt, số, ngày giờ và từ code-switch.
- Chưa có bộ đánh giá TTS: phát âm, độ tự nhiên, lỗi nội dung, thời gian sinh,
  kích thước và chi phí vận hành.
- Chưa có GPU profile/infra; B03 vẫn chặn smoke object storage thật.
- Embedding pipeline chưa gắn provider production; hybrid search T43 chưa làm.
- Chưa có quan sát job AI: queue depth, retry, dead letter, latency, model/version.
- Chưa có policy chống voice impersonation và lưu/xóa mẫu giọng tham chiếu.

## 3. Nguyên tắc kỹ thuật

- Provider-agnostic: domain nhận `TtsProvider`, không import SDK/model cụ thể.
- Offline generation: tạo audio trong worker, không synthesize trong request của
  visitor.
- Reproducible: mọi output lưu provider, model, immutable version, config hash,
  transcript hash, seed nếu provider hỗ trợ và checksum audio.
- Human-in-the-loop: output AI luôn là draft; không tự submit/approve/publish.
- Locale-aware: provider/voice được map từ locale config, có thể tắt độc lập.
- Privacy by default: không log transcript, prompt, audio hay raw reference voice.
- License by artifact: kiểm tra license của engine, weights, dataset và từng voice;
  không suy luận license voice chỉ từ license repository.
- Evaluation before rollout: model mới chạy shadow/batch benchmark trước khi bật.
- Fail closed: provider lỗi không làm mất transcript hoặc bản audio published cũ.

## 4. Checklist ưu tiên

### P0 — Bắt buộc trước khi phát triển AI production

- [ ] Chấp nhận ADR về TTS provider, model licensing, human review và voice consent.
- [ ] Hoàn tất locale config theo
  `CONFIGURABLE_MULTILINGUAL_NARRATION_PLAN.md`.
- [ ] Mở blocker B03 hoặc chọn object storage được phê duyệt và chạy smoke thật.
- [ ] Tạo `TtsProvider`/`TtsGenerationService` contract dùng lại trong worker.
- [ ] Thiết kế job idempotency theo `narrationId + transcriptHash + modelVersion`.
- [ ] Có queue retry với exponential backoff, timeout và dead-letter state.
- [ ] Tạo model/voice registry có license, source URL, checksum và trạng thái enable.
- [ ] Không cho AI output đi thẳng sang `published`.
- [ ] Tạo bộ câu đánh giá VI/EN, có tên riêng và dữ liệu thực tế đã được phép dùng.
- [ ] Định nghĩa ngưỡng pass trước khi xem kết quả benchmark.
- [ ] Benchmark Piper làm baseline trên CPU.
- [ ] Ghi attribution/license vào artifact và admin preview.
- [ ] Thêm metric/log không chứa transcript hoặc PII.

### P1 — Tạo giá trị AI cho MVP

- [ ] Tích hợp Piper bằng process/container riêng, không chạy native model trong API.
- [ ] Map mỗi locale sang provider/model/voice qua config.
- [ ] Chuẩn hóa transcript trước TTS nhưng lưu cả bản gốc và normalized hash.
- [ ] Thêm pronunciation dictionary có version cho tên POI.
- [ ] Sinh WAV lossless trung gian, kiểm tra duration/silence/clipping rồi encode
  định dạng phát hành được browser hỗ trợ.
- [ ] Admin có nút “Tạo audio AI”, progress, retry và nghe so sánh với bản cũ.
- [ ] Reviewer thấy rõ nhãn AI-generated, model/version và license.
- [ ] Visitor chỉ nhận audio đã publish; transcript luôn là fallback.
- [ ] Benchmark thêm ZeroTTS cho tiếng Việt.
- [ ] Benchmark MOSS-TTS khi có GPU; không đưa vào critical path CPU-only.
- [ ] Hoàn tất embedding provider và T43 hybrid ranking sau benchmark T41.
- [ ] Có feature flags độc lập cho TTS generation và hybrid search.

### P2 — Chỉ làm sau khi MVP có số liệu

- [ ] Thu thập feedback có consent: lỗi phát âm, khó nghe, tốc độ, giọng không phù hợp.
- [ ] Phân tích lỗi theo locale, loại tên riêng và độ dài câu.
- [ ] Chỉ fine-tune nếu prompt/config/dictionary không đạt ngưỡng đã định.
- [ ] Chuẩn bị dataset card, consent, license và quy trình xóa mẫu theo yêu cầu.
- [ ] Tách train/eval theo speaker và nội dung để tránh leakage.
- [ ] Pin code, base model, dataset snapshot, environment và random seed.
- [ ] Lưu checkpoint/metrics/artifact ngoài Git; Git chỉ lưu manifest và checksum.
- [ ] So sánh fine-tuned model với baseline bằng blind review.
- [ ] Chạy regression về tên riêng, số, tiếng Anh xen tiếng Việt và câu dài.
- [ ] Canary một nhóm POI trước; rollback bằng model/voice version.
- [ ] Chỉ xem xét dịch máy khi có editor bản ngữ review từng locale.
- [ ] Chỉ xem xét recommendation/personalization sau khi có consent và dữ liệu đủ.

## 5. Bộ đánh giá tối thiểu

### TTS

- Bộ câu riêng cho mỗi locale; không dùng chính dữ liệu train làm test.
- Nhóm câu: tên POI, địa danh, số/ngày/giờ, viết tắt, câu dài, dấu câu,
  code-switch và nội dung an toàn.
- Human rating mù: độ tự nhiên, dễ hiểu, đúng phát âm, tốc độ và mức phù hợp cho
  thuyết minh công viên.
- Automated checks: audio decode được, duration hợp lệ, không clipping, tỷ lệ
  silence, transcript-ASR CER/WER chỉ dùng làm tín hiệu phụ.
- Operational metrics: real-time factor, p50/p95 generation time, memory/GPU,
  error/retry rate và kích thước file.
- Release gate: không giảm chất lượng VI/EN đang publish; mọi lỗi đọc sai tên POI
  quan trọng phải được sửa hoặc override trước rollout.

### Semantic search

- Giữ Recall@10, MRR, nDCG@10 và zero-result accuracy của T41.
- Báo cáo riêng exact, typo, semantic, English/Vietnamese và location-aware.
- Hybrid không được làm giảm metric chính quá ngưỡng ADR quy định.
- Đo p50/p95 latency, index size và kết quả khi provider/vector unavailable.

## 6. Task packets

### AI00 — Governance và ADR

```text
Task ID: AI00
Goal: Chốt provider strategy, license, consent, review và release gates.
In scope: ADR, threat/privacy review, model evaluation rubric.
Out of scope: code inference, dataset collection, model training.
Dependencies completed: product/privacy ADR hiện tại.
Files/modules allowed: docs/adr/**, docs/product/**, docs/plans/**.
Contracts consumed: narration workflow, analytics privacy policy.
Contracts produced: AI governance ADR và model release checklist.
Required reading: AGENTS.md; docs/STATUS.md; FEATURE_REGISTRY; ADR 0004–0006.
Acceptance checks: commercial-use review covers code/weights/data/voice separately;
  human approval and voice consent are explicit.
Verification commands: documentation link/consistency check.
```

### AI01 — Evaluation corpus và pronunciation assets

```text
Task ID: AI01
Goal: Tạo benchmark tái lập cho TTS VI/EN và locale thử nghiệm thứ ba.
In scope: licensed text set, pronunciation dictionary, blind-review form,
  automated audio checks and baseline report schema.
Out of scope: collecting/cloning voices, training models.
Dependencies completed: contract v1 đã khóa; corpus/evaluation implementation có
  thể chạy độc lập, AI00 chỉ là release gate về quyền và consent.
Files/modules allowed: data/tts-evaluation/**, docs/product/**, scripts/**.
Contracts consumed: locale config, POI fixtures with approved rights.
Contracts produced: versioned dataset manifest, lexicon và evaluation report schema.
Required reading: B01 rights blocker; sample-data spec; narration locale plan.
Acceptance checks: no unlicensed text/audio; train/eval separation documented;
  validators reject missing license/source/checksum.
Verification commands: dataset validator and evaluation unit tests.
```

### AI02 — TTS worker foundation

```text
Task ID: AI02
Goal: Tạo provider-neutral, idempotent async TTS pipeline.
In scope: TtsProvider port, job model, retry/dead-letter, artifact manifest,
  audio validation/encoding boundary, model registry.
Out of scope: production model adapter, admin button, model training.
Dependencies completed: AI00; T24 media contract.
Files/modules allowed: apps/worker/**, packages/shared-types/**,
  infra/migrations/** nếu cần job persistence.
Contracts consumed: narration/media storage contracts.
Contracts produced: TtsGenerationService, job states, versioned artifact metadata.
Required reading: embedding service; narration media service; ADR from AI00.
Acceptance checks: duplicate job does not duplicate artifact; timeout/retry/dead-letter
  tested; transcript absent from logs; generated output remains draft.
Verification commands: worker lint/typecheck/test/build; migration up/down/up if added.
```

### AI03 — Piper baseline

```text
Task ID: AI03
Goal: Sinh narration bằng Piper cho VI/EN và một locale cấu hình thêm.
In scope: isolated Piper adapter/service, pinned voices, checksum/license manifest,
  CPU benchmark, WAV-to-release-format pipeline.
Out of scope: voice cloning, fine-tuning, automatic publish.
Dependencies completed: AI02 và backend fixtures; T25B/corpus đầy đủ chỉ cần
  trước integration benchmark I03.
Files/modules allowed: apps/worker/**, infra/docker/**, config/**, docs/**.
Contracts consumed: TtsProvider, model registry, locale provider mapping.
Contracts produced: Piper provider adapter and reproducible container/runtime.
Required reading: official Piper engine/voice model cards and AI00 ADR.
Acceptance checks: benchmark report generated; correct model chosen per locale;
  attribution persisted; CPU resource limits and cancellation tested.
Verification commands: provider contract tests; Docker smoke; TTS benchmark command.
```

### AI04 — Admin generation workflow

```text
Task ID: AI04
Goal: Cho editor tạo, theo dõi, nghe thử và gửi duyệt audio AI.
In scope: generation API, RBAC, status polling, retry/cancel, admin preview,
  provenance display and audit event.
Out of scope: visitor-triggered synthesis, auto approval.
Dependencies completed: contract v1 để làm UI bằng mock; AI03 chỉ cần trước I01.
Files/modules allowed: apps/api/**, apps/admin-web/**, OpenAPI/api-client,
  packages/shared-types/**.
Contracts consumed: TTS job/artifact and narration workflow.
Contracts produced: admin TTS generation endpoints and audit actions.
Required reading: auth/RBAC, narration admin, audit and media upload modules.
Acceptance checks: editor cannot approve; visitor cannot generate; stale transcript
  invalidates generated draft; old published audio remains available on failure.
Verification commands: contract/HTTP/RBAC tests; admin test/build; browser smoke.
```

### AI05 — Provider benchmark và lựa chọn

```text
Task ID: AI05
Goal: So sánh Piper, ZeroTTS VI và MOSS-TTS nếu có GPU.
In scope: adapters dùng chung contract; blind evaluation; latency/resource/license report.
Out of scope: production rollout hoặc fine-tuning.
Dependencies completed: AI02–AI03 cho benchmark fixture; corpus đầy đủ của Tú
  được chạy tại integration I03 trước quyết định rollout/fine-tune.
Files/modules allowed: apps/worker provider adapters, data/tts-evaluation/**, docs/**.
Contracts consumed: benchmark dataset/schema và TtsProvider.
Contracts produced: provider decision record with locale-specific recommendations.
Required reading: official repositories/model cards and AI00 release gates.
Acceptance checks: same normalized inputs and scoring; failures disclosed;
  recommendation includes hardware and license constraints.
Verification commands: reproducible benchmark command and report validator.
```

### AI06 — Fine-tuning pilot, có điều kiện

```text
Task ID: AI06
Goal: Fine-tune một model chỉ khi AI05 chứng minh baseline không đạt release gate.
In scope: approved dataset, training config, experiment tracking, checkpoint manifest,
  blind comparison and rollback artifact.
Out of scope: training from scratch, unauthorized voice cloning, auto rollout.
Dependencies completed: AI00, AI01, AI05; explicit coordinator GO decision.
Files/modules allowed: ml/tts/** hoặc apps/worker/training/** được coordinator cấp;
  data manifests only, no large audio/checkpoints in Git.
Contracts consumed: base-model license, dataset card, evaluation rubric.
Contracts produced: immutable candidate model version and model card.
Required reading: AI governance ADR, provider license, dataset consent/license records.
Acceptance checks: reproducible run; no train/eval leakage; candidate beats baseline;
  security/license review passes; rollback tested.
Verification commands: training smoke on tiny fixture; full benchmark; artifact checksum.
```

### AI07 — Semantic search production

```text
Task ID: AI07
Goal: Hoàn tất T42/T43 bằng embedding provider và hybrid ranking có rollback.
In scope: model benchmark, query embeddings, vector candidates, normalized fusion,
  feature flag, evaluation and latency checks.
Out of scope: generative answers/chatbot, personalized ranking.
Dependencies completed: T40–T42 foundation and T41 dataset.
Files/modules allowed: apps/worker embedding/**, apps/api search/**,
  infra/migrations/**, data/search-evaluation/**, shared contracts/OpenAPI.
Contracts consumed: EmbeddingProvider, semantic_embeddings, search API.
Contracts produced: hybrid search behavior behind a feature flag.
Required reading: PROJECT_PLAN sections 8/13; current lexical repository; T41 report.
Acceptance checks: metrics meet ADR threshold; lexical fallback works; model/version
  reproducible; p95 meets MVP target.
Verification commands: worker/API tests; real pgvector smoke; 50-query HTTP evaluation.
```

### AI08 — Production hardening

```text
Task ID: AI08
Goal: Vận hành AI an toàn, quan sát được và rollback được.
In scope: queue/model metrics, alerts, capacity limits, artifact retention,
  backup/restore, runbooks, canary and incident procedure.
Out of scope: new AI capabilities.
Dependencies completed: AI04, AI05, AI07; B03 closed.
Files/modules allowed: infra/**, apps/worker observability, docs/runbooks/**.
Contracts consumed: job/model/artifact metadata and feature flags.
Contracts produced: operational dashboards/alerts/runbooks.
Required reading: T52 observability plan and privacy policy.
Acceptance checks: failed provider, full queue, corrupt audio and model rollback drills pass;
  no content/PII in logs; quotas prevent resource exhaustion.
Verification commands: fault-injection smoke; restore drill; security and load checks.
```

## 7. Thứ tự triển khai

Owner và lịch song song chi tiết nằm tại
`docs/plans/CONG_TU_WORK_SPLIT.md`: Công phụ trách toàn bộ backend/AI/contract;
Tú phụ trách UI/UX/mobile và evaluation corpus bằng mock contract đã khóa. Hai
luồng chỉ ghép ở integration gate cuối.

```text
Công: backend contract -> AI02 -> AI03 -> AI05 + AI07 + backend hardening
Tú:   mock ports -> AI01 corpus + AI04 UI + locale/mobile UX
                                      \       /
                                       I01–I04 integration gates
```

Hai luồng implementation không phụ thuộc output của nhau. AI06 không tự động
trở thành READY: chỉ mở sau benchmark tích hợp I03, kiểm tra quyền dữ liệu và
quyết định GO. OpenAPI/shared contracts chỉ do Công sở hữu.

## 8. Definition of Done cho chương trình AI

- TTS generation chạy bất đồng bộ, idempotent, có review và rollback.
- Ít nhất VI/EN vượt release gate; locale mới thêm qua config/provider mapping.
- Model, voice, dataset và output có provenance/license/checksum.
- Không có voice cloning thiếu consent; không có transcript/reference voice trong log.
- Search hybrid vượt hoặc giữ baseline theo threshold đã chốt và có lexical fallback.
- Benchmark và training tái lập; checkpoint lớn không được commit vào Git.
- Object storage, queue, model failure và rollback đã được diễn tập.
- Registry/status/ADR/OpenAPI/runbook đồng bộ; root quality gate pass.

## 9. Nguồn ứng viên cần benchmark

- Piper: `https://github.com/OHF-Voice/piper1-gpl`
- Piper voices: `https://huggingface.co/rhasspy/piper-voices`
- ZeroTTS: `https://github.com/zeroweight-ai/ZeroTTS`
- MOSS-TTS: `https://github.com/OpenMOSS/MOSS-TTS`
- Chatterbox chỉ dùng làm đối chứng cho đến khi chất lượng tiếng Việt được nhà
  phát triển khuyến nghị cho production:
  `https://github.com/resemble-ai/chatterbox`

Luôn pin commit/model revision cụ thể trong model registry; không dùng `main` làm
production version.
