# Hướng dẫn làm việc cho agent

Tài liệu này áp dụng cho toàn repository. Mục tiêu là giúp nhiều agent làm việc nối tiếp hoặc song song mà không làm trùng, không phá contract và không phải đọc context không liên quan.

## 1. Nguồn sự thật

Đọc theo thứ tự và chỉ đọc phần cần thiết:

1. `AGENTS.md`: quy tắc làm việc bắt buộc.
2. `docs/STATUS.md`: wave/task hiện tại, blocker và handoff mới nhất.
3. `docs/AGENT_EXECUTION_PLAN.md`: task, dependency, owner và acceptance checklist.
4. `docs/FEATURE_REGISTRY.md`: những gì đã có và cách dùng lại.
5. `PROJECT_PLAN.md`: chỉ đọc section được task packet chỉ định.
6. Code, test và README gần thư mục đang sửa.

Nếu tài liệu và code mâu thuẫn, không tự đoán. Ghi rõ mâu thuẫn trong handoff; với contract công khai, tạo/cập nhật ADR trước khi thay đổi.

## 2. Quy tắc tiết kiệm token và context

- Không đọc toàn bộ repository nếu task đã nêu file/module liên quan. Dùng `rg`, `rg --files` và đọc theo phạm vi.
- Không chép lại nội dung từ `PROJECT_PLAN.md` vào tài liệu khác; dùng link section.
- Trước khi code, tìm trong `docs/FEATURE_REGISTRY.md`, `packages/`, module hiện tại và dependency manifest.
- Không gửi log dài trong handoff. Chỉ ghi command, kết quả, lỗi còn lại và đường dẫn artifact.
- Không đưa generated file, lockfile hoặc snapshot lớn vào prompt trừ khi task trực tiếp liên quan.
- Không tạo một abstraction chỉ được dùng một lần nếu code trực tiếp rõ hơn.
- Không tự viết lại khả năng đã có trong framework/library ổn định.
- Ưu tiên sửa nhỏ, độc lập, có test; tránh refactor ngoài phạm vi task.

## 3. Reuse-first protocol

Trước khi tạo component/service/helper/schema mới:

- [ ] Tìm theo tên feature và hành vi bằng `rg`.
- [ ] Kiểm tra `docs/FEATURE_REGISTRY.md`.
- [ ] Kiểm tra shared packages và dependency hiện có.
- [ ] Xác nhận không có API/component tương đương.
- [ ] Nếu vẫn cần viết mới, chọn vị trí có thể dùng lại hợp lý.
- [ ] Sau khi hoàn thành, đăng ký/cập nhật feature registry.

Thứ tự ưu tiên:

1. Dùng lại code/contract đã có trong repo.
2. Mở rộng shared module đã có mà không phá backward compatibility.
3. Dùng thư viện ổn định đang được project sử dụng.
4. Thêm dependency mới nếu có lý do và kiểm tra license/size/security.
5. Chỉ viết custom implementation khi bốn lựa chọn trên không phù hợp.

## 4. Task packet bắt buộc

Agent chỉ bắt đầu implementation khi task có tối thiểu:

```text
Task ID:
Goal:
In scope:
Out of scope:
Dependencies completed:
Files/modules allowed:
Contracts consumed:
Contracts produced:
Required reading:
Acceptance checks:
Verification commands:
```

Nếu thiếu chi tiết nhỏ, agent được phép suy luận theo contract hiện có. Nếu thiếu quyết định làm thay đổi schema/API/public behavior, dừng và báo coordinator.

## 5. Checklist cho mọi task

### Trước khi sửa

- [ ] Đọc task packet và section bắt buộc, không đọc lan rộng.
- [ ] Kiểm tra dependency của task đã hoàn thành.
- [ ] Kiểm tra worktree/status để không ghi đè thay đổi của agent khác.
- [ ] Tìm feature có sẵn theo reuse-first protocol.
- [ ] Xác định contract, test và file sở hữu.
- [ ] Nêu giả định nếu requirement chưa tuyệt đối rõ.

### Khi implementation

- [ ] Giữ thay đổi đúng scope.
- [ ] Không đổi public contract ngoài task packet.
- [ ] Validate input ở boundary và xử lý lỗi theo format chung.
- [ ] Không log token, password, GPS thô hoặc PII.
- [ ] Viết migration có đường rollback/forward-fix an toàn.
- [ ] Thêm/cập nhật unit hoặc integration test cùng feature.
- [ ] Dùng fixture/factory có sẵn thay vì tạo bộ dữ liệu trùng.
- [ ] Cập nhật OpenAPI/type dùng chung nếu contract thay đổi.

### Trước handoff

- [ ] Chạy formatter/lint/typecheck/test đúng phạm vi.
- [ ] Chạy acceptance checks của task.
- [ ] Kiểm tra diff chỉ chứa thay đổi cần thiết.
- [ ] Cập nhật `docs/FEATURE_REGISTRY.md` nếu tạo/thay đổi feature dùng lại.
- [ ] Cập nhật `docs/STATUS.md`; không đánh dấu hoàn thành nếu còn lỗi bắt buộc.
- [ ] Ghi handoff ngắn theo mẫu.

## 6. Handoff format

```text
Task: <ID> — <status: DONE/BLOCKED/PARTIAL>
Changed: <3–6 bullet, kèm đường dẫn>
Contracts: <API/schema/event thay đổi hoặc “none”>
Verified: <commands + pass/fail>
Reuse: <feature registry entries đã dùng/tạo>
Risks/blockers: <ngắn gọn>
Next task can start: <IDs>
```

Không dùng “DONE” nếu test bắt buộc chưa chạy hoặc acceptance criteria chưa đạt.

## 7. Ranh giới sở hữu để tránh conflict

- Mobile agent: `apps/mobile/**`.
- Admin agent: `apps/admin-web/**`.
- API agent: `apps/api/**`.
- Worker/search agent: `apps/worker/**` và search-specific module được giao.
- Shared-contract agent/coordinator: `packages/api-client/**`, `packages/shared-types/**`, OpenAPI.
- Geo agent: `data/geojson/**`, routing import/validation và migration graph được giao.
- DevOps/QA agent: `infra/**`, CI và test harness; không sửa business logic nếu chưa có task.

File shared chỉ có một owner tại một thời điểm. Agent cần thay file ngoài ownership phải ghi trong task packet hoặc yêu cầu coordinator cập nhật contract trước.

## 8. Contract-first rules

- API thay đổi: cập nhật OpenAPI trước hoặc trong cùng task, generate client và chạy contract test.
- Database thay đổi: migration mới; không sửa migration đã chạy trên shared environment.
- Event thay đổi: schema có `schemaVersion`; consumer phải chịu được field mới.
- Shared type thay đổi: ưu tiên additive; breaking change cần ADR và kế hoạch migrate.
- GeoJSON: giữ WGS84/SRID 4326, validate geometry/topology trước import.

## 9. Definition of Done chung

Một task chỉ hoàn thành khi code, test, documentation tối thiểu và registry đồng bộ; lint/typecheck liên quan chạy qua; không có secret/PII trong code hoặc log; acceptance checks có bằng chứng; blocker/risk còn lại được ghi rõ.
